import assert from 'node:assert/strict'
import test from 'node:test'
import type { ElicitResult } from '@modelcontextprotocol/sdk/types.js'
import { createSerialExecutor, requestSendApproval, SELF_SEND_TOOLS } from '../server-policy.js'

const destination = '+14155550123'
const text = 'Test message'

function elicitationResult(action: 'accept' | 'decline' | 'cancel', approved?: boolean): ElicitResult {
  return {
    action,
    ...(approved === undefined ? {} : { content: { approved } }),
  }
}

test('requires elicitation support and an explicit accept with approved true', async () => {
  let calls = 0
  const elicit = async () => {
    calls++
    return elicitationResult('accept', true)
  }

  assert.equal(await requestSendApproval(false, elicit, destination, text), false)
  assert.equal(calls, 0, 'must not request an approval the client cannot display')

  assert.equal(await requestSendApproval(true, async () => elicitationResult('decline'), destination, text), false)
  assert.equal(await requestSendApproval(true, async () => elicitationResult('cancel'), destination, text), false)
  assert.equal(await requestSendApproval(true, async () => elicitationResult('accept', false), destination, text), false)
  assert.equal(await requestSendApproval(true, async () => elicitationResult('accept'), destination, text), false)
  assert.equal(await requestSendApproval(true, elicit, destination, text), true)
})

test('approval prompt contains the fixed destination and exact message', async () => {
  let prompt = ''
  const approved = await requestSendApproval(true, async params => {
    prompt = params.message
    return elicitationResult('accept', true)
  }, destination, text)

  assert.equal(approved, true)
  assert.ok(prompt.includes(destination))
  assert.ok(prompt.endsWith(text))
})

test('exposes only login, status, and text-only self-send tools', () => {
  assert.deepEqual(SELF_SEND_TOOLS.map(tool => tool.name), [
    'gv_login',
    'gv_check_login',
    'gv_send_to_self',
  ])
  const sendTool = SELF_SEND_TOOLS.find(tool => tool.name === 'gv_send_to_self')
  assert.ok(sendTool)
  assert.deepEqual(Object.keys(sendTool.inputSchema.properties), ['text'])
  assert.deepEqual(sendTool.inputSchema.required, ['text'])
})

test('serial executor runs operations in order and continues after rejection', async () => {
  const serialize = createSerialExecutor()
  const events: string[] = []
  let releaseFirst!: () => void
  let firstStarted!: () => void
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
  const started = new Promise<void>(resolve => { firstStarted = resolve })

  const first = serialize(async () => {
    events.push('first-start')
    firstStarted()
    await firstGate
    events.push('first-end')
  })
  await started
  const second = serialize(async () => { events.push('second') })
  await Promise.resolve()
  assert.deepEqual(events, ['first-start'])

  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ['first-start', 'first-end', 'second'])

  await assert.rejects(serialize(async () => { throw new Error('expected') }), /expected/)
  await serialize(async () => { events.push('after-rejection') })
  assert.equal(events.at(-1), 'after-rejection')
})
