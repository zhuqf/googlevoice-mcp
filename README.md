# mcp-googlevoice

MCP server that provides Google Voice SMS tools for any MCP-compatible AI agent harness.

Since Google Voice has no public API, this server uses system Chromium with Playwright (via CDP) for browser automation against the Google Voice web interface.

## Tools

| Tool | Description |
|------|-------------|
| `gv_login` | Open browser for Google login |
| `gv_check_login` | Check login status |
| `gv_list_sms` | List SMS conversations (`filter`: all/unread, `limit`) |
| `gv_read_sms` | Read messages in a conversation (`filter`: all/unread, `limit`) |
| `gv_send_sms` | Send SMS to phone number(s) — supports single or multiple recipients |
| `gv_reply_sms` | Reply to a conversation |
| `gv_mark_read` | Mark conversation as read |

## Requirements

- Node.js 18+
- System Chromium or Google Chrome (`sudo apt install chromium` or install Google Chrome)
- Xvfb for headless servers (`sudo apt install xvfb`)

> Playwright is installed as a dependency for its automation library. The actual browser used at runtime is your **system** Chrome/Chromium — not Playwright's bundled browser — to avoid Google's automation detection.

## Configuration

All harnesses use the same `npx` command. The only difference is which file you add the config to.

### Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)  
File: `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "googlevoice": {
      "command": "npx",
      "args": ["-y", "mcp-googlevoice"]
    }
  }
}
```

### Claude Code

File: `.mcp.json` in your project root, or `~/.claude/mcp.json` globally.

```json
{
  "mcpServers": {
    "googlevoice": {
      "command": "npx",
      "args": ["-y", "mcp-googlevoice"]
    }
  }
}
```

### Cursor

File: `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project).

```json
{
  "mcpServers": {
    "googlevoice": {
      "command": "npx",
      "args": ["-y", "mcp-googlevoice"]
    }
  }
}
```

### Windsurf

File: `~/.windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "googlevoice": {
      "command": "npx",
      "args": ["-y", "mcp-googlevoice"]
    }
  }
}
```

### VS Code (GitHub Copilot)

File: `.vscode/mcp.json` in your workspace.

```json
{
  "servers": {
    "googlevoice": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-googlevoice"]
    }
  }
}
```

### Alternative: global install

Install once, then reference by name (no `npx` needed):

```bash
npm install -g mcp-googlevoice
```

```json
{
  "mcpServers": {
    "googlevoice": {
      "command": "mcp-googlevoice"
    }
  }
}
```

Ready-to-use config files for each harness are also in the [`configs/`](./configs/) directory of this repo.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLEVOICE_STATE_DIR` | `~/.local/share/openclaw/googlevoice` | Directory for browser profile and state |
| `GOOGLEVOICE_DEBUG_PORT` | `9222` | Chrome remote debugging port |

Set them in the `env` block of your harness config if you need non-default values:

```json
{
  "mcpServers": {
    "googlevoice": {
      "command": "npx",
      "args": ["-y", "mcp-googlevoice"],
      "env": {
        "GOOGLEVOICE_STATE_DIR": "/home/youruser/.local/share/mcp-googlevoice",
        "GOOGLEVOICE_DEBUG_PORT": "9223"
      }
    }
  }
}
```

## First-Time Login

Because Google Voice requires interactive authentication (including 2FA), the first-time setup uses Chrome remote debugging:

1. Call `gv_login` — system Chromium launches with Xvfb and remote debugging on port 9222
2. From your local machine, set up an SSH tunnel:
   ```
   ssh -L 9222:localhost:9222 <your-server>
   ```
3. Open Chrome locally, go to `chrome://inspect/#devices`
4. Click "Configure..." and add `localhost:9222`
5. Click "inspect" on the Google Voice target
6. Complete Google login (including 2FA) in the DevTools window
7. Once you see Google Voice Messages, call `gv_check_login` to verify

After login, Chrome runs as a detached background process. It survives MCP/harness restarts and preserves the session — no re-login needed as long as Chrome keeps running.

## How It Works

All browser operations use a single system Chromium process (not Playwright's bundled browser, which Google detects and blocks). Playwright connects to it via CDP (Chrome DevTools Protocol).

- **Login**: `gv_login` launches system Chromium with Xvfb and remote debugging. The user connects via SSH tunnel + `chrome://inspect` to complete interactive login/2FA.
- **Operations**: `ensureBrowser()` launches Chromium if not already running, then Playwright connects via `connectOverCDP()` to automate SMS operations.
- **Persistence**: Chrome runs as a detached background process and survives MCP restarts. Playwright disconnects on shutdown but reconnects on next operation.
- **Idle cleanup**: Playwright connection auto-disconnects after 5 min idle (Chrome keeps running).

## OpenClaw Plugin

This repo also ships as an OpenClaw-native plugin plus an MCP server config. The native plugin keeps a stable plugin id (`googlevoice`) while showing the friendly name `Google Voice SMS`.

### Install for OpenClaw

```bash
# From local directory (development)
openclaw plugins install /path/to/googlevoice-mcp --dangerously-force-unsafe-install

# Or track live source edits
openclaw plugins install /path/to/googlevoice-mcp --link --dangerously-force-unsafe-install

# Register the Google Voice MCP server for tool access
openclaw mcp set googlevoice '{"command":"npx","args":["-y","mcp-googlevoice"]}'

# Reload OpenClaw
openclaw gateway restart
```

The unsafe-install flag is required because the server launches system Chromium/Xvfb for Google Voice browser automation.

### Install from archive

```bash
npm run pack:openclaw            # creates googlevoice-openclaw-plugin.tgz
openclaw plugins install ./googlevoice-openclaw-plugin.tgz --dangerously-force-unsafe-install
openclaw mcp set googlevoice '{"command":"npx","args":["-y","mcp-googlevoice"]}'
openclaw gateway restart
```

### What the plugin provides

| Feature | Detail |
|---------|--------|
| Plugin id | `googlevoice` |
| Plugin name | `Google Voice SMS` |
| Skill: `googlevoice` | Interactive login guidance, status check, and SMS usage workflow |
| MCP tools | `gv_login`, `gv_check_login`, `gv_list_sms`, `gv_read_sms`, `gv_send_sms`, `gv_reply_sms`, `gv_mark_read` — registered as `googlevoice__<tool>` after `openclaw mcp set` |
| MCP transport | stdio via `npx mcp-googlevoice` |

### OpenClaw layout

```
openclaw.plugin.json        ← OpenClaw-native plugin manifest (id: googlevoice, name: Google Voice SMS)
skills/googlevoice/SKILL.md ← Google Voice setup and usage skill
.mcp.json                   ← compatibility MCP server config (npx mcp-googlevoice)
```

### Verify install

```bash
openclaw plugins list                    # should show id googlevoice, name Google Voice SMS
openclaw plugins inspect googlevoice     # check plugin metadata and skill
openclaw mcp show googlevoice            # check MCP server config
```

Then ask OpenClaw to configure Google Voice or call the `gv_login`/`gv_check_login` MCP tools through the `googlevoice` skill flow.

## Development

```bash
git clone <repo>
cd googlevoice-mcp
npm install
npm run dev          # run directly with tsx (no build needed)
npm run build        # compile TypeScript → dist/
node dist/server.js  # run compiled output
npm run pack:openclaw # create googlevoice-openclaw-plugin.tgz
```
