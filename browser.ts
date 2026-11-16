import { chromium, type BrowserContext, type Page } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { SELECTORS } from './selectors.js'

const STATE_DIR = process.env.GOOGLEVOICE_STATE_DIR
  ?? join(homedir(), '.local', 'share', 'openclaw', 'googlevoice')
const PROFILE_DIR = join(STATE_DIR, 'browser-profile')

export const VOICE_MESSAGES_URL = 'https://voice.google.com/u/0/messages'
const VOICE_ORIGIN = new URL(VOICE_MESSAGES_URL).origin

// Find system Chrome/Chromium (avoids Google's Playwright automation detection)
function findSystemChrome(): string {
  const configured = process.env.GOOGLEVOICE_CHROME_PATH
  if (configured && existsSync(configured)) return configured

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ...['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'],
  ]
  for (const name of candidates) {
    try {
      if (name.startsWith('/')) {
        if (existsSync(name)) return name
      } else {
        return execFileSync('which', [name], { encoding: 'utf-8' }).trim()
      }
    } catch {}
  }
  throw new Error('No system Chrome/Chromium found. Set GOOGLEVOICE_CHROME_PATH or install Chrome.')
}

let context: BrowserContext | null = null
let page: Page | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let ensureLock: Promise<Page> | null = null
const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  // Close the owned browser on idle; the profile persists on disk for next login.
  idleTimer = setTimeout(() => {
    closeBrowser().catch(() => {})
  }, IDLE_TIMEOUT_MS)
}

/** Launch an isolated, owned system Chrome instance controlled over Playwright's private pipe. */
async function launchOwnedBrowser(): Promise<Page> {
  mkdirSync(PROFILE_DIR, { recursive: true })

  const chromePath = findSystemChrome()
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      executablePath: chromePath,
      headless: false,
      args: ['--no-first-run', '--no-default-browser-check', '--window-size=1280,900'],
    })
    page = context.pages()[0] ?? await context.newPage()
    await page.goto(VOICE_MESSAGES_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
    return page
  } catch (error) {
    await closeBrowser()
    throw error
  }
}

/**
 * Launch the owned system Chrome window for interactive login.
 * Login happens directly in that window; no remote debugging port is exposed.
 */
export async function launchLoginBrowser(): Promise<string> {
  await shutdownBrowser()
  await launchOwnedBrowser()
  return findSystemChrome()
}

/**
 * Get a Playwright-controlled page for automated operations.
 * Launches an isolated system Chrome if needed and returns its owned page.
 */
export async function ensureBrowser(): Promise<Page> {
  resetIdleTimer()

  if (context && page && !page.isClosed()) {
    return page
  }

  // Prevent concurrent launches
  if (ensureLock) return ensureLock
  ensureLock = (async () => {
    try {
      if (context) await closeBrowser()
      return await launchOwnedBrowser()
    } finally {
      ensureLock = null
    }
  })()
  return ensureLock
}

// --- Shutdown ---

/** Close the owned Chrome context and all browser processes it launched. */
export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  const ownedContext = context
  context = null
  page = null
  if (ownedContext) await ownedContext.close().catch(() => {})
}

/** Stop the owned browser process and clear pending browser work. */
export async function shutdownBrowser(): Promise<void> {
  await closeBrowser()
}

/** Verify the page is the one created by this server and is exactly on Google Voice HTTPS. */
export function assertOwnedVoicePage(candidate: Page): void {
  if (!context || candidate !== page || candidate.isClosed()) {
    throw new Error('Refusing to operate on a page not owned by this server.')
  }
  let origin = ''
  try { origin = new URL(candidate.url()).origin } catch {}
  if (origin !== VOICE_ORIGIN) {
    throw new Error(`Refusing browser operation outside ${VOICE_ORIGIN}.`)
  }
}

// --- Navigation & login check ---

export async function checkLoginStatus(): Promise<boolean> {
  try {
    const p = await ensureBrowser()
    let origin = ''
    try { origin = new URL(p.url()).origin } catch {}
    if (origin !== VOICE_ORIGIN) {
      // Initial navigation can be redirected to Google's sign-in origin.
      if (origin === 'https://accounts.google.com') return false
      await p.goto(VOICE_MESSAGES_URL, { waitUntil: 'load', timeout: 15000 })
    }

    assertOwnedVoicePage(p)

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
  assertOwnedVoicePage(p)
  const url = p.url()
  const parsed = new URL(url)
  if (parsed.origin !== VOICE_ORIGIN) throw new Error(`Refusing navigation from unexpected origin: ${parsed.origin}`)
  if (parsed.pathname !== new URL(VOICE_MESSAGES_URL).pathname || parsed.searchParams.has('itemId')) {
    await p.goto(VOICE_MESSAGES_URL, { waitUntil: 'load', timeout: 15000 })
  }
  assertOwnedVoicePage(p)
}

export async function navigateToConversation(p: Page, conversationId: string): Promise<void> {
  assertOwnedVoicePage(p)
  if (!/^t\.[\w%+.-]+$/.test(conversationId)) throw new Error('Invalid Google Voice conversation ID.')
  const targetUrl = `${VOICE_MESSAGES_URL}?itemId=${encodeURIComponent(conversationId)}`
  const parsed = new URL(p.url())
  if (parsed.origin !== VOICE_ORIGIN) throw new Error(`Refusing navigation from unexpected origin: ${parsed.origin}`)
  if (parsed.searchParams.get('itemId') !== conversationId) {
    await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await p.waitForSelector(SELECTORS.MESSAGE_BUBBLE, { timeout: 10000 }).catch(() => {})
  }
  assertOwnedVoicePage(p)
}
