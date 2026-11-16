import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasExactRecipientEvidence,
  isE164PhoneNumber,
  isExactOutgoingMessage,
  isNewOutgoingMessageCount,
  verifiedConversationId,
} from '../safety.js'

const destination = '+14155550123'

test('accepts only a valid E.164 fixed destination', () => {
  assert.equal(isE164PhoneNumber(destination), true)
  assert.equal(isE164PhoneNumber('4155550123'), false)
  assert.equal(isE164PhoneNumber('+0123456789'), false)
  assert.equal(isE164PhoneNumber('+14155550123456789'), false)
})

test('requires visible evidence for exactly the configured recipient', () => {
  assert.equal(hasExactRecipientEvidence(`Send to ${destination}`, destination), true)
  assert.equal(hasExactRecipientEvidence('Send to +14155550124', destination), false)
  assert.equal(hasExactRecipientEvidence(`To ${destination} and +14155550124`, destination), false)
  assert.equal(hasExactRecipientEvidence('Send to Self', destination), false)
})

test('accepts a conversation id only from the exact Google Voice messages URL', () => {
  assert.equal(verifiedConversationId('https://voice.google.com/u/0/messages?itemId=t.12345'), 't.12345')
  assert.equal(verifiedConversationId('https://voice.google.com.evil.example/u/0/messages?itemId=t.12345'), undefined)
  assert.equal(verifiedConversationId('http://voice.google.com/u/0/messages?itemId=t.12345'), undefined)
  assert.equal(verifiedConversationId('https://voice.google.com/u/0/other?itemId=t.12345'), undefined)
  assert.equal(verifiedConversationId('https://voice.google.com/u/0/messages?itemId=bad'), undefined)
})

test('verifies exact outgoing text, not inbound or approximate text', () => {
  assert.equal(isExactOutgoingMessage('hello', ' hello ', false), true)
  assert.equal(isExactOutgoingMessage('hello', 'hello!', false), false)
  assert.equal(isExactOutgoingMessage('hello', 'hello', true), false)
  assert.equal(isNewOutgoingMessageCount(1, 2), true)
  assert.equal(isNewOutgoingMessageCount(1, 1), false)
})
