---
name: googlevoice
description: Set up Google Voice self-send using the local Google Voice MCP server, check sign-in status, or send an explicitly approved SMS to the configured fixed destination.
metadata: { "openclaw": { "emoji": "📞" } }
---

# Google Voice self-send

This server exposes only `gv_login`, `gv_check_login`, and `gv_send_to_self`. It cannot read inbox messages, reply to conversations, mark messages read, accept a recipient from the model, or send to a group.

## Setup and sign-in

1. Install dependencies from the checkout with `npm ci` and build it with `npm run build`.
2. Configure the MCP client to launch the checkout's `dist/server.js`, not an `npx` package.
3. Configure `GOOGLEVOICE_SELF_NUMBER` in the server environment with the user's own E.164 number.
4. Call `gv_login`; the user signs into Google Voice in the local Chrome window. No remote debugging port or SSH tunnel is used.
5. Call `gv_check_login` after sign-in.

## Sending

Only call `gv_send_to_self` when the user has asked to send the exact message. It accepts a message body only; the fixed destination comes from server configuration. The server must show a separate MCP elicitation prompt with the destination and exact message, and the user must explicitly approve it. If the client cannot show that prompt, sending is disabled.

Never retry an uncertain result. The server verifies the selected destination before sending and checks the outgoing message in the resulting thread afterward. If verification is uncertain, tell the user no retry was attempted and ask them to check Google Voice manually before deciding what to do.