# Google Voice self-send MCP

A local MCP server for sending one SMS at a time to a fixed, user-configured Google Voice destination. It uses system Chrome controlled by Playwright and does not expose a Chrome remote-debugging port.

## Available tools

| Tool | Purpose |
|------|---------|
| `gv_login` | Open the owned local Chrome window for interactive sign-in |
| `gv_check_login` | Check whether Google Voice is signed in |
| `gv_send_to_self` | Send text only to `GOOGLEVOICE_SELF_NUMBER`, after explicit client approval |

Inbox reading, replies, mark-read, caller-supplied recipients, and group sends are not exposed.

## Requirements

- Node.js 18+
- Google Chrome or Chromium installed on the same machine as the MCP server
- A graphical desktop session for first-time sign-in

This setup deliberately does not support remote debugging or headless login. Keep the profile directory private to your OS account.
If an older version left Chrome running with this profile, close that legacy browser before first starting the hardened server. This version will not attach to, or kill, a browser process it does not own.

## Install this checked-out source

Run these commands from the repository checkout. `npm ci` installs exactly the dependency versions in `package-lock.json`; build the checked-out source before configuring an MCP client:

```sh
npm ci
npm run build
```

Configure the client to run the local `dist/server.js` from this checkout, not `npx` or a globally published package. Set `GOOGLEVOICE_SELF_NUMBER` in the MCP server environment to your own number in E.164 format (for example, `+14155550123`). Do not pass a recipient through the tool call.

The repository `.mcp.json` is configured for this checkout. Other examples are in [`configs/`](configs/); replace `/path/to/googlevoice-mcp` with the checkout's absolute path and set your number. If source changes, rebuild and restart the MCP server.

Example configuration:

```json
{
  "mcpServers": {
    "googlevoice": {
      "command": "node",
      "args": ["/absolute/path/to/googlevoice-mcp/dist/server.js"],
      "env": {
        "GOOGLEVOICE_SELF_NUMBER": "+14155550123"
      }
    }
  }
}
```

For VS Code, use the `servers` root object and include `"type": "stdio"` as shown in [`configs/vscode.json`](configs/vscode.json).

## Sign in and send

1. Start or reload the MCP server from the checked-out build.
2. Call `gv_login` and complete Google sign-in in the local Chrome window.
3. Call `gv_check_login` to verify the session.
4. To send, provide the exact message to `gv_send_to_self`. The MCP client must display a separate approval prompt showing the fixed destination and exact message. Declining, canceling, or a client without elicitation support blocks sending.
5. A post-send result is reported as verified only when the server sees the exact outgoing message in the intended Google Voice thread. If the result is uncertain, do not retry automatically; check Google Voice manually first.

## Browser and message safety

- Playwright launches and owns a persistent system Chrome context; its private control pipe is not exposed as a network listener.
- The server operates only on its own page and checks the exact `https://voice.google.com` origin.
- Browser operations are serialized. The browser and its child processes are closed on server shutdown; cookies remain in the on-disk browser profile.
- The destination is configured outside model-controlled tool arguments and must be E.164.
- The server confirms the selected destination and draft before clicking Send, then verifies the outgoing message and thread. It never automatically retries.
- Tests use offline fixtures and do not sign in or send a real message.

## Development and tests

```sh
npm ci
npm test
npm run build
```

Do not run `gv_send_to_self` in production until you have reviewed the configured destination and the approval workflow. Tests and build do not contact Google Voice.