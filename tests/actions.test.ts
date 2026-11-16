import assert from 'node:assert/strict'
import test from 'node:test'
import type { Page } from 'playwright'
import { sendSms } from '../actions.js'
import { SELECTORS } from '../selectors.js'

const destination = '+14155550123'
const text = 'Test message'

interface MockOptions {
  suggestionText?: string
  bodyText?: string
  draftMatches?: boolean
  verificationFails?: boolean
  url?: string
}

function createMockPage(options: MockOptions = {}) {
  let draft = ''
  let outgoingMessageExists = false
  let sendClicks = 0

  const outgoingBubble = {
    async $(selector: string) {
      if (selector === SELECTORS.MESSAGE_INCOMING) return null
      if (selector === SELECTORS.MESSAGE_TEXT) return { innerText: async () => text }
      return null
    },
  }

  const mockPage = {
    async click() {},
    async waitForSelector(selector: string) {
      if (selector === SELECTORS.RECIPIENT_INPUT) return { fill: async () => {} }
      if (selector === SELECTORS.RECIPIENT_SUGGESTION) {
        return {
          innerText: async () => options.suggestionText ?? `Send to ${destination}`,
          click: async () => {},
        }
      }
      throw new Error(`Unexpected selector: ${selector}`)
    },
    locator(selector: string) {
      if (selector === 'body') {
        return { innerText: async () => options.bodyText ?? `To ${destination}` }
      }
      if (selector === SELECTORS.COMPOSE_INPUT) {
        return {
          first: () => ({
            click: async () => {},
            fill: async (value: string) => { draft = value },
            inputValue: async () => options.draftMatches === false ? `${draft} changed` : draft,
          }),
        }
      }
      if (selector === SELECTORS.SEND_BUTTON) {
        return {
          first: () => ({
            isEnabled: async () => true,
            click: async () => {
              sendClicks++
              outgoingMessageExists = true
            },
          }),
        }
      }
      throw new Error(`Unexpected locator: ${selector}`)
    },
    async $$(selector: string) {
      return selector === SELECTORS.MESSAGE_BUBBLE && outgoingMessageExists ? [outgoingBubble] : []
    },
    async waitForFunction() {
      if (options.verificationFails) throw new Error('simulated verification timeout')
    },
    url: () => options.url ?? 'https://voice.google.com/u/0/messages?itemId=t.12345',
  }

  return { page: mockPage as unknown as Page, getSendClicks: () => sendClicks }
}

const noBrowser = {
  navigateToMessages: async () => {},
  assertOwnedVoicePage: () => {},
}

test('does not click Send if the recipient suggestion is not the fixed destination', async () => {
  const mock = createMockPage({ suggestionText: 'Send to +14155550124' })

  await assert.rejects(sendSms(mock.page, destination, text, noBrowser), /suggestion did not match/)
  assert.equal(mock.getSendClicks(), 0)
})

test('does not click Send if the selected recipient or draft cannot be verified', async t => {
  await t.test('selected recipient mismatch', async () => {
    const mock = createMockPage({ bodyText: 'To +14155550124' })
    await assert.rejects(sendSms(mock.page, destination, text, noBrowser), /selected recipient/)
    assert.equal(mock.getSendClicks(), 0)
  })

  await t.test('draft mismatch', async () => {
    const mock = createMockPage({ draftMatches: false })
    await assert.rejects(sendSms(mock.page, destination, text, noBrowser), /message draft/)
    assert.equal(mock.getSendClicks(), 0)
  })
})

test('reports verified success after a new outgoing message appears in the destination thread', async () => {
  const mock = createMockPage()
  const result = await sendSms(mock.page, destination, text, noBrowser)

  assert.equal(result.status, 'sent')
  assert.equal(result.conversationId, 't.12345')
  assert.equal(mock.getSendClicks(), 1)
})

test('reports uncertain after a post-send verification failure and never retries', async () => {
  const mock = createMockPage({ verificationFails: true })
  const result = await sendSms(mock.page, destination, text, noBrowser)

  assert.equal(result.status, 'uncertain')
  assert.match(result.detail, /Do not retry automatically/)
  assert.equal(mock.getSendClicks(), 1)
})

test('reports uncertain if the outgoing message appears but the thread URL is invalid', async () => {
  const mock = createMockPage({ url: 'https://voice.google.com.evil.example/u/0/messages?itemId=t.12345' })
  const result = await sendSms(mock.page, destination, text, noBrowser)

  assert.equal(result.status, 'uncertain')
  assert.equal(mock.getSendClicks(), 1)
})
