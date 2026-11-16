import type { Page } from 'playwright'
import { SELECTORS } from './selectors.js'
import { assertOwnedVoicePage, navigateToMessages } from './browser.js'
import {
  hasExactRecipientEvidence,
  isE164PhoneNumber,
  isExactOutgoingMessage,
  isNewOutgoingMessageCount,
  verifiedConversationId,
} from './safety.js'

export interface SendSmsResult {
  status: 'sent' | 'uncertain'
  conversationId?: string
  detail: string
}

async function countOutgoingMessages(page: Page, expectedText: string): Promise<number> {
  const bubbles = await page.$$(SELECTORS.MESSAGE_BUBBLE)
  let count = 0
  for (const bubble of bubbles) {
    if (await bubble.$(SELECTORS.MESSAGE_INCOMING)) continue
    const text = await bubble.$(SELECTORS.MESSAGE_TEXT).then(el => el?.innerText() ?? '').catch(() => '')
    if (isExactOutgoingMessage(expectedText, text, false)) count++
  }
  return count
}

/** Send once to the configured destination. A post-click failure is reported as uncertain, never retried. */
export async function sendSms(page: Page, phoneNumber: string, text: string): Promise<SendSmsResult> {
  if (!isE164PhoneNumber(phoneNumber)) {
    throw new Error('Configured self destination must be an E.164 phone number.')
  }
  if (!text.trim()) throw new Error('Message text must not be empty.')

  await navigateToMessages(page)
  await page.click(SELECTORS.NEW_CONVERSATION_BUTTON, { timeout: 5000 })

  const recipientInput = await page.waitForSelector(SELECTORS.RECIPIENT_INPUT, { timeout: 5000 })
  await recipientInput.fill(phoneNumber)
  const popup = await page.waitForSelector(SELECTORS.RECIPIENT_SUGGESTION, { timeout: 5000 })
  if (!hasExactRecipientEvidence(await popup.innerText(), phoneNumber)) {
    throw new Error('Google Voice recipient suggestion did not match the configured destination; nothing was sent.')
  }
  await popup.click()

  assertOwnedVoicePage(page)
  if (!hasExactRecipientEvidence(await page.locator('body').innerText(), phoneNumber)) {
    throw new Error('Could not verify the selected recipient is exactly the configured destination; nothing was sent.')
  }

  const composeInput = page.locator(SELECTORS.COMPOSE_INPUT).first()
  await composeInput.click()
  await composeInput.fill(text)
  if ((await composeInput.inputValue()) !== text) {
    throw new Error('Could not verify the message draft; nothing was sent.')
  }

  const sendButton = page.locator(SELECTORS.SEND_BUTTON).first()
  if (!(await sendButton.isEnabled())) throw new Error('Google Voice send button is disabled; nothing was sent.')
  const previousMatchingOutgoingCount = await countOutgoingMessages(page, text)

  // Once click is attempted, any failure is uncertain. Never retry automatically.
  try {
    await sendButton.click()
    await page.waitForFunction(
      ({ bubbleSelector, textSelector, expectedText, previousCount }) => {
        const currentCount = Array.from(document.querySelectorAll(bubbleSelector)).filter(bubble => {
          if (bubble.querySelector('.incoming')) return false
          return bubble.querySelector(textSelector)?.textContent?.trim() === expectedText.trim()
        }).length
        return currentCount > previousCount
      },
      {
        bubbleSelector: SELECTORS.MESSAGE_BUBBLE,
        textSelector: SELECTORS.MESSAGE_TEXT,
        expectedText: text,
        previousCount: previousMatchingOutgoingCount,
      },
      { timeout: 10000 },
    )

    assertOwnedVoicePage(page)
    const conversationId = verifiedConversationId(page.url())
    const recipientStillMatches = hasExactRecipientEvidence(await page.locator('body').innerText(), phoneNumber)
    const newMessageAppeared = isNewOutgoingMessageCount(
      previousMatchingOutgoingCount,
      await countOutgoingMessages(page, text),
    )
    if (!conversationId || !recipientStillMatches || !newMessageAppeared) {
      return {
        status: 'uncertain',
        detail: 'The send action was initiated, but the intended thread and outgoing message could not both be verified. Do not retry automatically.',
      }
    }
    return { status: 'sent', conversationId, detail: 'The outgoing message and destination thread were verified.' }
  } catch (error) {
    return {
      status: 'uncertain',
      detail: `The send action may have reached Google Voice, but verification failed (${error instanceof Error ? error.message : String(error)}). Do not retry automatically.`,
    }
  }
}