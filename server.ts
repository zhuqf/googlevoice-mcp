#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { ensureBrowser, launchLoginBrowser, closeBrowser, checkLoginStatus, REMOTE_DEBUG_PORT } from './browser.js'
import { listSms, readConversation, sendSms, replySms, markAsRead } from './actions.js'

const server = new Server(
  { name: 'googlevoice', version: '0.0.1' },
  { capabilities: { tools: {} } },
)

// --- Tool Definitions ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'gv_login',
      description:
        'Launch system Chrome with remote debugging for Google login. The user connects via SSH tunnel and chrome://inspect to complete login (including 2FA). After login, call gv_check_login to verify.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'gv_check_login',
      description: 'Check whether the user is currently logged into Google Voice.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'gv_list_sms',
      description:
        'List recent SMS conversations from Google Voice. Returns conversation ID, contact, last message snippet, timestamp, and read/unread status.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filter: {
            type: 'string',
            enum: ['all', 'unread'],
            description: 'Filter conversations: "all" or "unread" only. Default: "all".',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of conversations to return. Default: 20.',
          },
        },
      },
    },
    {
      name: 'gv_read_sms',
      description:
        'Read messages within a specific SMS conversation. Returns individual messages with sender, text, timestamp, and direction.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          conversation_id: {
            type: 'string',
            description: 'The conversation ID (from gv_list_sms results).',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of messages to return (most recent). Default: 50.',
          },
          filter: {
            type: 'string',
            enum: ['all', 'unread'],
            description: 'Filter: "all" returns messages regardless, "unread" only returns messages if the conversation has unread messages. Default: "all".',
          },
        },
        required: ['conversation_id'],
      },
    },
    {
      name: 'gv_send_sms',
      description: 'Send a new SMS message to one or more phone numbers via Google Voice.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          phone_number: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ],
            description: 'The recipient phone number(s) (e.g., "+1234567890" or ["+1234567890", "+0987654321"]).',
          },
          text: {
            type: 'string',
            description: 'The message text to send.',
          },
        },
        required: ['phone_number', 'text'],
      },
    },
    {
      name: 'gv_reply_sms',
      description: 'Reply to an existing SMS conversation.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          conversation_id: {
            type: 'string',
            description: 'The conversation ID to reply to.',
          },
          text: {
            type: 'string',
            description: 'The reply message text.',
          },
        },
        required: ['conversation_id', 'text'],
      },
    },
    {
      name: 'gv_mark_read',
      description: 'Mark an SMS conversation as read.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          conversation_id: {
            type: 'string',
            description: 'The conversation ID to mark as read.',
          },
        },
        required: ['conversation_id'],
      },
    },
  ],
}))

// --- Tool Handlers ---

function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true }
}

function textResult(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] }
}

async function requireLogin(): Promise<string | null> {
  const loggedIn = await checkLoginStatus()
  if (!loggedIn) {
    return 'Not logged in to Google Voice. Please run gv_login first.'
  }
  return null
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>

  try {
    switch (req.params.name) {
      // --- Login ---
      case 'gv_login': {
        // Launch system Chrome (not Playwright) to avoid Google's automation detection
        const chromePath = await launchLoginBrowser()

        return textResult(
          `System Chrome (${chromePath}) launched with remote debugging on port ${REMOTE_DEBUG_PORT}.\n\n` +
          'To complete login interactively from your local machine:\n' +
          `1. Set up an SSH tunnel:  ssh -L ${REMOTE_DEBUG_PORT}:localhost:${REMOTE_DEBUG_PORT} <your-server>\n` +
          `2. Open Chrome and go to:  chrome://inspect/#devices\n` +
          `3. Click "Configure..." and add localhost:${REMOTE_DEBUG_PORT}\n` +
          '4. Click "inspect" on the Google Voice target\n' +
          '5. Complete Google login (including 2FA if prompted)\n' +
          '6. Once you see Google Voice Messages, call gv_check_login to verify.\n\n' +
          'Alternatively, set GOOGLEVOICE_DEBUG_PORT to use a different port.',
        )
      }

      case 'gv_check_login': {
        const loggedIn = await checkLoginStatus()
        if (loggedIn) {
          return textResult('Logged in to Google Voice. All tools are ready to use.')
        }
        return textResult(
          'Not logged in. Run gv_login to open a browser window and complete Google login.',
        )
      }

      // --- List SMS ---
      case 'gv_list_sms': {
        const loginErr = await requireLogin()
        if (loginErr) return errorResult(loginErr)

        const page = await ensureBrowser()
        const filter = (args.filter as string) === 'unread' ? 'unread' : 'all'
        const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100))

        const conversations = await listSms(page, { filter, limit })
        if (conversations.length === 0) {
          return textResult(filter === 'unread' ? 'No unread SMS conversations.' : 'No SMS conversations found.')
        }
        return textResult(JSON.stringify(conversations, null, 2))
      }

      // --- Read Conversation ---
      case 'gv_read_sms': {
        const loginErr = await requireLogin()
        if (loginErr) return errorResult(loginErr)

        const conversationId = args.conversation_id as string
        if (!conversationId) return errorResult('conversation_id is required.')

        const page = await ensureBrowser()
        const limit = Math.max(1, Math.min(Number(args.limit) || 50, 200))
        const readFilter = (args.filter as string) === 'unread' ? 'unread' : 'all'
        const messages = await readConversation(page, conversationId, limit, readFilter)

        if (messages.length === 0) {
          return textResult('No messages found in this conversation.')
        }
        return textResult(JSON.stringify(messages, null, 2))
      }

      // --- Send SMS ---
      case 'gv_send_sms': {
        const loginErr = await requireLogin()
        if (loginErr) return errorResult(loginErr)

        const phoneNumber = args.phone_number as string | string[]
        const text = args.text as string
        if (!phoneNumber || !text) return errorResult('phone_number and text are required.')

        const page = await ensureBrowser()
        const conversationId = await sendSms(page, phoneNumber, text)

        const recipients = Array.isArray(phoneNumber) ? phoneNumber.join(', ') : phoneNumber
        return textResult(
          `SMS sent to ${recipients}.` +
          (conversationId ? ` Conversation ID: ${conversationId}` : ''),
        )
      }

      // --- Reply SMS ---
      case 'gv_reply_sms': {
        const loginErr = await requireLogin()
        if (loginErr) return errorResult(loginErr)

        const conversationId = args.conversation_id as string
        const text = args.text as string
        if (!conversationId || !text) return errorResult('conversation_id and text are required.')

        const page = await ensureBrowser()
        await replySms(page, conversationId, text)

        return textResult(`Reply sent to conversation ${conversationId}.`)
      }

      // --- Mark Read ---
      case 'gv_mark_read': {
        const loginErr = await requireLogin()
        if (loginErr) return errorResult(loginErr)

        const conversationId = args.conversation_id as string
        if (!conversationId) return errorResult('conversation_id is required.')

        const page = await ensureBrowser()
        await markAsRead(page, conversationId)

        return textResult(`Conversation ${conversationId} marked as read.`)
      }

      default:
        return errorResult(`Unknown tool: ${req.params.name}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`googlevoice: tool ${req.params.name} failed: ${msg}\n`)
    return errorResult(`Error: ${msg}`)
  }
})

// --- Test Mode ---

async function testMode() {
  const { checkLoginStatus } = await import('./browser.js')
  console.log('Checking login status...')
  const loggedIn = await checkLoginStatus()
  if (loggedIn) {
    console.log('Logged in to Google Voice.')
  } else {
    console.log('Not logged in. Run gv_login first.')
  }
  await import('./browser.js').then(m => m.closeBrowser())
  process.exit(0)
}

// --- Start Server ---

async function main() {
  if (process.argv.includes('--test')) {
    await testMode()
    return
  }
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('googlevoice: MCP server started\n')
}

main().catch((err) => {
  process.stderr.write(`googlevoice: fatal: ${err}\n`)
  process.exit(1)
})

// Cleanup on stdin close (MCP convention)
process.stdin.on('end', () => {
  closeBrowser().then(() => process.exit(0))
})
