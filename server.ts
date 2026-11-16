#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { ensureBrowser, launchLoginBrowser, shutdownBrowser, checkLoginStatus } from './browser.js'
import { sendSms } from './actions.js'

const server = new Server(
  { name: 'googlevoice-self-send', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

let operationQueue: Promise<void> = Promise.resolve()

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation)
  operationQueue = result.then(() => undefined, () => undefined)
  return result
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

function textResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }] }
}

function configuredDestination(): string {
  const number = process.env.GOOGLEVOICE_SELF_NUMBER ?? ''
  if (!/^\+[1-9]\d{7,14}$/.test(number)) {
    throw new Error('Set GOOGLEVOICE_SELF_NUMBER to your own E.164 number in the MCP server environment.')
  }
  return number
}

async function requestSendApproval(destination: string, text: string): Promise<boolean> {
  if (!server.getClientCapabilities()?.elicitation?.form) return false
  const approval = await server.elicitInput({
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

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
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
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async req => serialize(async () => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'gv_login': {
        const chromePath = await launchLoginBrowser()
        return textResult(`Opened ${chromePath} for Google Voice login. Complete sign-in in that local browser window, then call gv_check_login.`)
      }

      case 'gv_check_login': {
        const loggedIn = await checkLoginStatus()
        return textResult(loggedIn ? 'Logged in to Google Voice.' : 'Not logged in. Call gv_login and complete sign-in in the local browser window.')
      }

      case 'gv_send_to_self': {
        const destination = configuredDestination()
        const text = args.text
        if (typeof text !== 'string' || !text.trim()) return errorResult('text is required and must not be empty.')
        if (text.length > 2000) return errorResult('text is too long for this SMS tool.')
        if (!server.getClientCapabilities()?.elicitation?.form) {
          return errorResult('Sending is disabled because this MCP client cannot display the required user approval prompt.')
        }
        const approved = await requestSendApproval(destination, text)
        if (!approved) return errorResult('Send cancelled or not explicitly approved; no message was sent.')

        if (!(await checkLoginStatus())) return errorResult('Not logged in to Google Voice. No message was sent.')
        const result = await sendSms(await ensureBrowser(), destination, text)
        if (result.status === 'uncertain') {
          return errorResult(`Send outcome uncertain. ${result.detail}`)
        }
        return textResult(`Message sent to the configured self destination and verified in conversation ${result.conversationId}.`)
      }

      default:
        return errorResult(`Unknown or disabled tool: ${req.params.name}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`googlevoice: tool ${req.params.name} failed: ${message}\n`)
    return errorResult(`Error: ${message}`)
  }
}))

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('googlevoice: self-send MCP server started\n')
}

let shuttingDown = false
async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  await shutdownBrowser()
  process.exit(exitCode)
}

main().catch(error => {
  process.stderr.write(`googlevoice: fatal: ${error}\n`)
  void shutdown(1)
})

process.stdin.on('end', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })