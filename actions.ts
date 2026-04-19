import type { Page } from 'playwright'
import { SELECTORS } from './selectors.js'
import { navigateToMessages, navigateToConversation, VOICE_MESSAGES_URL } from './browser.js'
import type { SmsConversation, SmsMessage } from './types.js'

export async function listSms(
  page: Page,
  options: { filter: 'all' | 'unread'; limit: number },
): Promise<SmsConversation[]> {
  await navigateToMessages(page)

  await page.waitForSelector(SELECTORS.CONVERSATION_ITEM, { timeout: 10000 })

  // First pass: extract visible data and conversation IDs from all items.
  // Uses history.pushState interception to capture the conversation URL
  // without actually navigating — this avoids marking unread conversations as read.
  const rawItems = await page.$$eval(SELECTORS.CONVERSATION_ITEM, (els, sel) => {
    return els.map(el => {
      const container = el.querySelector(sel.clickable)
      const isUnread = !container?.classList.contains(sel.readClass)
      const contact = el.querySelector(sel.contact)?.textContent?.trim() || ''
      const snippet = el.querySelector(sel.snippet)?.textContent?.trim() || ''
      const timestamp = el.querySelector(sel.timestamp)?.textContent?.trim() || ''
      return { contact, snippet, timestamp, isUnread }
    })
  }, {
    clickable: SELECTORS.CONVERSATION_CLICKABLE,
    readClass: SELECTORS.CONVERSATION_READ_CLASS,
    contact: SELECTORS.CONVERSATION_CONTACT,
    snippet: SELECTORS.CONVERSATION_SNIPPET,
    timestamp: SELECTORS.CONVERSATION_TIMESTAMP,
  })

  // Filter and limit
  const filtered = rawItems
    .map((item, index) => ({ ...item, index }))
    .filter(item => options.filter === 'all' || item.isUnread)
    .slice(0, options.limit)

  // Second pass: extract conversation IDs by intercepting history.pushState
  // on click, then restoring state — avoids navigating into the conversation
  // which would mark it as read.
  const conversations: SmsConversation[] = []
  for (const item of filtered) {
    const conversationId = await page.evaluate((params) => {
      return new Promise<string>((resolve) => {
        const origPush = history.pushState.bind(history)
        const origReplace = history.replaceState.bind(history)

        history.pushState = function() {
          history.pushState = origPush
          history.replaceState = origReplace
          const url = arguments[2] as string | undefined
          const match = url?.match(/itemId=([^&]+)/)
          resolve(match ? decodeURIComponent(match[1]) : '')
        }
        history.replaceState = function() {
          history.pushState = origPush
          history.replaceState = origReplace
          const url = arguments[2] as string | undefined
          const match = url?.match(/itemId=([^&]+)/)
          resolve(match ? decodeURIComponent(match[1]) : '')
        }

        const items = document.querySelectorAll(params.item)
        const el = items[params.index]
        const clickTarget = el?.querySelector(params.clickable) as HTMLElement
        if (clickTarget) {
          clickTarget.click()
        }

        // Fallback timeout
        setTimeout(function() {
          history.pushState = origPush
          history.replaceState = origReplace
          resolve('')
        }, 3000)
      })
    }, { index: item.index, item: SELECTORS.CONVERSATION_ITEM, clickable: SELECTORS.CONVERSATION_CLICKABLE })

    // After intercepting pushState, Angular may have partially updated the view.
    // Navigate back to the messages list to reset state for the next item.
    if (conversationId) {
      await page.goto(VOICE_MESSAGES_URL, { waitUntil: 'load', timeout: 15000 })
      await page.waitForSelector(SELECTORS.CONVERSATION_ITEM, { timeout: 10000 })
    }

    conversations.push({
      conversationId,
      contact: item.contact,
      lastMessage: item.snippet,
      lastTimestamp: item.timestamp,
      isUnread: item.isUnread,
    })
  }

  return conversations
}

export async function readConversation(
  page: Page,
  conversationId: string,
  limit: number,
  filter: 'all' | 'unread' = 'all',
): Promise<SmsMessage[]> {
  if (filter === 'unread') {
    const unreadConversations = await listSms(page, { filter: 'unread', limit: 50 })
    const isUnread = unreadConversations.some(c => c.conversationId === conversationId)
    if (!isUnread) return []
  }

  await navigateToConversation(page, conversationId)

  await page.waitForSelector(SELECTORS.MESSAGE_BUBBLE, { timeout: 10000 })

  const bubbles = await page.$$(SELECTORS.MESSAGE_BUBBLE)
  const messages: SmsMessage[] = []

  const start = Math.max(0, bubbles.length - limit)
  for (let i = start; i < bubbles.length; i++) {
    const bubble = bubbles[i]

    const text = await bubble
      .$(SELECTORS.MESSAGE_TEXT)
      .then(el => el?.innerText() ?? '')
      .catch(() => '')

    const timestamp = await bubble
      .$(SELECTORS.MESSAGE_TIMESTAMP)
      .then(el => el?.innerText() ?? '')
      .catch(() => '')

    const isInbound = await bubble
      .$(SELECTORS.MESSAGE_INCOMING)
      .then(el => el !== null)
      .catch(() => false)

    const sender = isInbound ? 'contact' : 'me'

    messages.push({
      conversationId,
      sender,
      text: text.trim(),
      timestamp: timestamp.trim(),
      isUnread: false,
      isInbound,
    })
  }

  return messages
}

export async function sendSms(
  page: Page,
  phoneNumber: string | string[],
  text: string,
): Promise<string> {
  await navigateToMessages(page)

  await page.click(SELECTORS.NEW_CONVERSATION_BUTTON, { timeout: 5000 })

  const numbers = Array.isArray(phoneNumber) ? phoneNumber : [phoneNumber]

  for (let i = 0; i < numbers.length; i++) {
    const num = numbers[i]

    // Wait for the appropriate input field
    if (i === 0) {
      const recipientInput = await page.waitForSelector(SELECTORS.RECIPIENT_INPUT, { timeout: 5000 })
      await recipientInput.fill(num)
    } else {
      const addRecipientsInput = await page.waitForSelector('input[placeholder="Add recipients"]', { timeout: 5000 })
      await addRecipientsInput.fill(num)
    }

    await page.waitForTimeout(2000)

    // Click the "Send to <number>" popup that appears below the input
    const popup = await page.waitForSelector('.send-to-label', { timeout: 5000 })
    if (popup) {
      await popup.click()
    }

    await page.waitForTimeout(1000)
  }

  // Dismiss any overlay and focus the compose area
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  const composeInput = page.locator(SELECTORS.COMPOSE_INPUT).first()
  await composeInput.click()
  await page.waitForTimeout(200)
  await composeInput.pressSequentially(text)
  await page.waitForTimeout(500)

  const sendBtn = page.locator(SELECTORS.SEND_BUTTON).first()
  await sendBtn.click({ force: true })

  await page.waitForTimeout(2000)

  // Extract conversation ID from URL
  const url = page.url()
  const match = url.match(/itemId=([^&]+)/)
  const conversationId = match ? decodeURIComponent(match[1]) : ''

  return conversationId
}

export async function replySms(
  page: Page,
  conversationId: string,
  text: string,
): Promise<void> {
  await navigateToConversation(page, conversationId)

  const composeInput = await page.waitForSelector(SELECTORS.COMPOSE_INPUT, { timeout: 5000 })
  await composeInput.fill(text)

  await page.click(SELECTORS.SEND_BUTTON, { timeout: 5000 })

  await page.waitForTimeout(2000)
}

export async function markAsRead(
  page: Page,
  conversationId: string,
): Promise<void> {
  await navigateToConversation(page, conversationId)
  await page.waitForTimeout(1000)

  try {
    const moreBtn = await page.$(SELECTORS.MORE_OPTIONS_BUTTON)
    if (moreBtn) {
      await moreBtn.click()
      await page.waitForTimeout(500)
      const markReadBtn = await page.$(SELECTORS.MARK_READ_OPTION)
      if (markReadBtn) {
        await markReadBtn.click()
      } else {
        await page.keyboard.press('Escape')
      }
    }
  } catch {
    // Opening the conversation already marked it as read
  }
}
