import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { SELECTORS } from './selectors.js'

const STATE_DIR = process.env.GOOGLEVOICE_STATE_DIR
  ?? join(homedir(), '.local', 'share', 'openclaw', 'googlevoice')
const PROFILE_DIR = join(STATE_DIR, 'browser-profile')

export const VOICE_MESSAGES_URL = 'https://voice.google.com/u/0/messages'

// Remote debugging port — used for both login (user connects) and operations (Playwright connects via CDP)
export const REMOTE_DEBUG_PORT = Number(process.env.GOOGLEVOICE_DEBUG_PORT) || 9222

// Find system Chrome/Chromium (avoids Google's Playwright automation detection)
function findSystemChrome(): string {
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium']) {
    try {
      return execSync(`which ${name}`, { encoding: 'utf-8' }).trim()
    } catch {}
  }
  throw new Error('No system Chrome/Chromium found. Install chromium or google-chrome.')
}

/** Remove stale lock files left by crashed Chrome processes */
function cleanStaleLocks(): void {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const lockPath = join(PROFILE_DIR, name)
    if (existsSync(lockPath)) {
      try { rmSync(lockPath, { force: true }) } catch {}
    }
  }
}

let chromeProcess: ChildProcess | null = null
let xvfbProcess: ChildProcess | null = null
let browser: Browser | null = null
let page: Page | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let ensureLock: Promise<Page> | null = null
const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  // On idle, disconnect Playwright but keep Chrome running to preserve login
  idleTimer = setTimeout(() => {
    closeBrowser().catch(() => {})
  }, IDLE_TIMEOUT_MS)
}

/** Check if system Chrome is already running with our debug port */
function isChromeRunning(): boolean {
  try {
    execSync(`curl -s http://localhost:${REMOTE_DEBUG_PORT}/json/version`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Launch system Chrome with Xvfb and remote debugging */
async function launchChrome(url?: string): Promise<void> {
  if (isChromeRunning()) return

  mkdirSync(PROFILE_DIR, { recursive: true })
  cleanStaleLocks()

  const chromePath = findSystemChrome()

  await startXvfb()

  const args = [
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${REMOTE_DEBUG_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--window-size=1280,900',
  ]
  if (url) args.push(url)

  chromeProcess = spawn(chromePath, args, {
    stdio: 'ignore',
    detached: true,       // survive MCP server shutdown
    env: { ...process.env },
  })
  chromeProcess.unref()   // don't block MCP exit

  chromeProcess.on('exit', () => {
    chromeProcess = null
  })

  // Wait for debug port to be ready
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 500))
    if (isChromeRunning()) return
  }

  throw new Error('System Chrome failed to start within 10 seconds')
}

/** Connect Playwright to the running system Chrome via CDP */
async function connectPlaywright(): Promise<Page> {
  if (browser && page && !page.isClosed()) {
    return page
  }

  // Disconnect old connection if stale
  if (browser) {
    try { browser.close() } catch {}
    browser = null
    page = null
  }

  browser = await chromium.connectOverCDP(`http://localhost:${REMOTE_DEBUG_PORT}`)

  const contexts = browser.contexts()
  const ctx = contexts[0]
  if (!ctx) throw new Error('No browser context found')

  // Find an existing Google Voice page, or use the first available page
  const pages = ctx.pages()
  page = pages.find(p => p.url().includes('voice.google.com'))
    ?? pages[0]
    ?? await ctx.newPage()

  // If no Voice page was found, navigate to it
  if (!page.url().includes('voice.google.com')) {
    await page.goto(VOICE_MESSAGES_URL, { waitUntil: 'load', timeout: 15000 })
  }

  return page
}

/**
 * Launch system Chrome for interactive login.
 * User connects via SSH tunnel + chrome://inspect to complete Google login.
 */
export async function launchLoginBrowser(): Promise<string> {
  await shutdownBrowser()
  await launchChrome(VOICE_MESSAGES_URL)
  return findSystemChrome()
}

/**
 * Get a Playwright-controlled page for automated operations.
 * Launches system Chrome if needed, then connects via CDP.
 */
export async function ensureBrowser(): Promise<Page> {
  resetIdleTimer()

  if (browser && page && !page.isClosed()) {
    return page
  }

  // Prevent concurrent launches
  if (ensureLock) return ensureLock
  ensureLock = (async () => {
    try {
      await launchChrome()
      return await connectPlaywright()
    } finally {
      ensureLock = null
    }
  })()
  return ensureLock
}

// --- Xvfb management ---

async function startXvfb(): Promise<void> {
  if (xvfbProcess) return

  let display = 99
  for (let d = 99; d < 200; d++) {
    try {
      execSync(`ls /tmp/.X${d}-lock 2>/dev/null`, { stdio: 'ignore' })
    } catch {
      display = d
      break
    }
  }

  const displayStr = `:${display}`
  xvfbProcess = spawn('Xvfb', [displayStr, '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], {
    stdio: 'ignore',
    detached: true,
  })
  xvfbProcess.unref()

  await new Promise(resolve => setTimeout(resolve, 500))

  process.env.DISPLAY = displayStr
  process.stderr.write(`googlevoice: Xvfb started on ${displayStr}\n`)
}

function stopXvfb(): void {
  if (xvfbProcess) {
    xvfbProcess.kill()
    xvfbProcess = null
  }
}

// --- Shutdown ---

/** Gracefully stop Chrome and wait for it to exit */
async function stopChrome(): Promise<void> {
  if (!chromeProcess) return

  chromeProcess.kill('SIGTERM')

  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => {
      if (chromeProcess) chromeProcess.kill('SIGKILL')
      resolve()
    }, 5000)

    if (chromeProcess) {
      chromeProcess.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    } else {
      clearTimeout(timeout)
      resolve()
    }
  })

  chromeProcess = null
}

/** Disconnect Playwright from Chrome (Chrome keeps running in the background) */
export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (browser) {
    try { browser.close() } catch {}
    browser = null
    page = null
  }
  // Chrome and Xvfb intentionally keep running — session cookies only
  // persist while Chrome is alive. Killing Chrome loses the Google login.
}

/** Full shutdown: kill Chrome and Xvfb. Only used for gv_login (to restart fresh). */
export async function shutdownBrowser(): Promise<void> {
  await closeBrowser()
  await stopChrome()
  stopXvfb()
}

// --- Navigation & login check ---

export async function checkLoginStatus(): Promise<boolean> {
  try {
    const p = await ensureBrowser()
    const url = p.url()

    // Only navigate if not already on voice.google.com (avoid reload which destroys DOM)
    if (!url.includes('voice.google.com')) {
      await p.goto(VOICE_MESSAGES_URL, { waitUntil: 'load', timeout: 15000 })
    }

    const currentUrl = p.url()
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
      return false
    }

    // Check for sidenav — if already loaded, querySelector is instant; otherwise wait
    const el = await p.$(SELECTORS.LOGGED_IN_INDICATOR)
    if (el) return true

    // Page may still be loading after navigation — wait for it
    try {
      await p.waitForSelector(SELECTORS.LOGGED_IN_INDICATOR, { timeout: 10000 })
      return true
    } catch {
      return false
    }
  } catch {
    return false
  }
}

export async function navigateToMessages(p: Page): Promise<void> {
  const url = p.url()
  // Navigate if not on the messages list (or if on a specific conversation)
  if (!url.startsWith(VOICE_MESSAGES_URL) || url.includes('itemId=')) {
    await p.goto(VOICE_MESSAGES_URL, { waitUntil: 'load', timeout: 15000 })
    await p.waitForSelector(SELECTORS.CONVERSATION_ITEM, { timeout: 10000 }).catch(() => {})
  }
}

export async function navigateToConversation(p: Page, conversationId: string): Promise<void> {
  const targetUrl = `${VOICE_MESSAGES_URL}?itemId=${encodeURIComponent(conversationId)}`
  const url = p.url()
  if (!url.includes(`itemId=${encodeURIComponent(conversationId)}`)) {
    await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await p.waitForSelector(SELECTORS.MESSAGE_BUBBLE, { timeout: 10000 }).catch(() => {})
  }
}

// On MCP server shutdown, disconnect Playwright but keep Chrome alive to preserve login session
process.on('SIGINT', () => { closeBrowser().then(() => process.exit(0)) })
process.on('SIGTERM', () => { closeBrowser().then(() => process.exit(0)) })
