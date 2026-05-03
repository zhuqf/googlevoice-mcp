---
name: googlevoice
description: Set up and use Google Voice SMS via the googlevoice MCP server. Use when the user asks to configure Google Voice, log in, check connection/status, list/read SMS conversations, send/reply to SMS, or mark Google Voice messages read.
metadata: { "openclaw": { "emoji": "📞" } }
---

# Google Voice MCP

Google Voice has no public API. This plugin uses a system Chrome/Chromium browser controlled by Playwright through the `googlevoice` MCP server.

## Tools

Use the MCP tools exposed by the `googlevoice` server:

- `gv_login` — launch system Chrome with remote debugging for interactive Google login/2FA.
- `gv_check_login` — verify whether Google Voice is connected.
- `gv_list_sms` — list recent SMS conversations (`filter`: `all` or `unread`, `limit`).
- `gv_read_sms` — read a conversation by `conversation_id`.
- `gv_send_sms` — send a new SMS to one or more phone numbers.
- `gv_reply_sms` — reply to an existing conversation.
- `gv_mark_read` — mark a conversation read.

Depending on the harness, tool names may be exposed as `googlevoice__gv_*` or `mcp__googlevoice__gv_*`.

## Setup/status flow

When the user asks to configure, log in, or check status:

1. Call `gv_check_login` first unless the user explicitly asked to start login.
2. If logged in, tell the user Google Voice is connected and the SMS tools are ready.
3. If not logged in, call `gv_login`.
4. Tell the user to complete login from their local machine:
   - Set up an SSH tunnel using the port returned by the tool, usually `ssh -L 9222:localhost:9222 <server>`.
   - Open Chrome to `chrome://inspect/#devices`.
   - Click **Configure...** and add `localhost:9222`.
   - Click **inspect** on the Google Voice target.
   - Complete Google login and 2FA until the Google Voice Messages page is visible.
5. When the user says they are done, call `gv_check_login` again and report the result.

## SMS safety

Sending or replying to SMS is external communication. Draft or confirm with the user before sending unless they explicitly provided the recipient/conversation and exact message text in the current request.

For listing/reading messages, keep results concise and do not expose more private message content than needed for the user's request.

## Local state

Default state directory: `~/.local/share/openclaw/googlevoice`.

Optional MCP server env vars:

- `GOOGLEVOICE_STATE_DIR` — override the browser profile/state directory.
- `GOOGLEVOICE_DEBUG_PORT` — override Chrome remote debugging port, default `9222`.
