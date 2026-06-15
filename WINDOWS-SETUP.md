# mcp-googlevoice on Windows (adapted)

The upstream `mcp-googlevoice` server assumes a headless Linux server (Xvfb +
SSH-tunnel login). These two patched files make it run on Windows with your
**local, visible Chrome** — you just log in to the window that pops up. No Xvfb,
no SSH tunnel.

## What changed

- **`browser.ts`** — now cross-platform:
  - Finds Chrome at the standard Windows paths (`C:\Program Files\Google\Chrome\Application\chrome.exe`, the x86 path, and `%LOCALAPPDATA%`); falls back to Edge; honors a `GOOGLEVOICE_CHROME_PATH` override.
  - Skips Xvfb entirely except on a headless Linux server (no `DISPLAY`).
  - Replaces the `curl` health-check with Node's built-in `fetch` (no curl dependency).
- **`server.ts`** — the `gv_login` tool now prints simple "log into the Chrome
  window that just opened" instructions on desktop, and only shows the
  SSH-tunnel steps on a real headless server.

Nothing else changed. No new network calls, no new dependencies.

## Install

You need **Node.js 18+** and **Google Chrome** installed.

```powershell
# 1. Get the source
git clone https://github.com/zhuqf/googlevoice-mcp.git
cd googlevoice-mcp

# 2. Drop in the two patched files (copy browser.ts and server.ts from this
#    folder over the originals), then:
npm install
npm run build        # compiles TypeScript -> dist\

# 3. Sanity-check that it can find Chrome and the server starts
node dist\server.js --test
```

`--test` will report "Not logged in" the first time — that's expected.

## Connect to Claude Code / Claude Desktop

Because this is your local fork (not the npm package), point the config at the
built file instead of `npx`.

**Claude Code** — add to `.mcp.json` in your project, or `~\.claude\mcp.json`:

```json
{
  "mcpServers": {
    "googlevoice": {
      "command": "node",
      "args": ["C:\\path\\to\\googlevoice-mcp\\dist\\server.js"]
    }
  }
}
```

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json`, same block.

Restart the harness so it picks up the server.

## First-time login

1. Ask the agent to call **`gv_login`** (or run `node dist\server.js --test`
   after a manual launch). A normal Chrome window opens to `voice.google.com`.
2. Log into your Google account in that window, including 2FA.
3. Once you see your Google Voice Messages, call **`gv_check_login`** — it should
   say "Logged in."
4. **Leave that Chrome window open.** The session only lives while that Chrome
   process is running; closing it logs you out and you'll have to repeat login.

That Chrome runs as a detached background process with its own dedicated profile
(stored under `%USERPROFILE%\.local\share\openclaw\googlevoice` by default, or
wherever you set `GOOGLEVOICE_STATE_DIR`). It survives MCP restarts.

## Tools available

`gv_login`, `gv_check_login`, `gv_list_sms`, `gv_read_sms`, `gv_send_sms`,
`gv_reply_sms`, `gv_mark_read`.

## Optional env vars

| Variable | Purpose |
|----------|---------|
| `GOOGLEVOICE_CHROME_PATH` | Explicit path to `chrome.exe` if auto-detect misses it |
| `GOOGLEVOICE_STATE_DIR` | Where the browser profile/session is stored |
| `GOOGLEVOICE_DEBUG_PORT` | Chrome remote-debugging port (default 9222) |

## Caveats (unchanged from upstream)

- Browser automation against Google Voice is against Google's ToS and is
  inherently fragile — if Google changes the page, selectors in `selectors.ts`
  may need updating.
- It's an early project (v0.0.1). You're running your own audited build from
  source, which is the safer way to use it.
