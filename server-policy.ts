import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/sdk/types.js'

export const SELF_SEND_TOOLS = [
  {
    name: 'gv_login',
    description: 'Open the locally owned system Chrome window so you can sign in to Google Voice. No remote debugging listener is opened.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'gv_check_login',
    description: 'Check whether Google Voice is signed in on this server-owned browser.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'gv_send_to_self',
    description: 'Send one SMS to the fixed destination configured in GOOGLEVOICE_SELF_NUMBER. The server asks for explicit user approval of the destination and exact message before sending.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', minLength: 1, description: 'Exact SMS text to send to the configured self destination.' },
      },
      required: ['text'],
    },
  },
]

export function createSerialExecutor() {
  let queue: Promise<void> = Promise.resolve()
  return function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
}

export async function requestSendApproval(
  elicitationSupported: boolean,
  elicit: (params: ElicitRequestFormParams) => Promise<ElicitResult>,
  destination: string,
  text: string,
): Promise<boolean> {
  if (!elicitationSupported) return false
  const approval = await elicit({
    mode: 'form',
    message: `Approve sending this exact SMS to your configured number ${destination}?\n\n${text}`,
    requestedSchema: {
      type: 'object',
      properties: {
        approved: {
          type: 'boolean',
          title: 'Approve this send',
          description: 'Only approve if the destination and exact message above are correct.',
        },
      },
      required: ['approved'],
    },
  })
  return approval.action === 'accept' && approval.content?.approved === true
}
