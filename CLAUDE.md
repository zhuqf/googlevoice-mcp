# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MCP server plugin that provides Google Voice SMS tools (list, read, send, reply, mark-read) via browser automation. Google Voice has no public API, so this uses system Chromium controlled by Playwright through CDP.

## Commands

```bash
npm install                      # install deps
npx playwright install chromium  # install Playwright library (system Chromium is used at runtime)
npx tsx server.ts                # run the MCP server (normally launched by Claude Code via .mcp.json)
```

No build step, tests, or linter configured. Code is TypeScript executed directly via `tsx`.

## Architecture

**Single-browser CDP approach**: All operations use one system Chromium process. Playwright never launches its own browser — it connects to the running Chrome via `connectOverCDP()`. This avoids Google detecting/blocking Playwright's patched Chromium binary.

### Key Files

- **`server.ts`** — MCP server. Registers 7 tools (`gv_login`, `gv_check_login`, `gv_list_sms`, `gv_read_sms`, `gv_send_sms`, `gv_reply_sms`, `gv_mark_read`). Thin handler layer that delegates to `browser.ts` and `actions.ts`.
- **`browser.ts`** — Browser lifecycle management. Two modes:
  - `launchLoginBrowser()` — Spawns system Chromium with Xvfb + `--remote-debugging-port=9222`. User connects via SSH tunnel + `chrome://inspect` to complete Google login/2FA.
  - `ensureBrowser()` — Ensures Chrome is running, then connects Playwright via CDP. Returns a `Page` for automation.
  - Chrome runs detached and survives MCP restarts. On shutdown, Playwright disconnects but Chrome stays alive to preserve the login session.
- **`actions.ts`** — SMS operations (list, read, send, reply, mark-read). Uses Playwright Page API against the Google Voice web DOM.
- **`selectors.ts`** — All CSS/attribute selectors for the Google Voice DOM, isolated for maintenance. Google changes their UI periodically — when things break, this is the first file to update.
- **`types.ts`** — `SmsConversation` and `SmsMessage` interfaces.

### Browser Flow

```
gv_login:  shutdownBrowser() → launchChrome(url) → [user logs in via chrome://inspect]
gv_*:      ensureBrowser() → launchChrome() [if needed] → connectOverCDP() → return Page
shutdown:  closeBrowser() → disconnect Playwright only (Chrome stays running)
```

### Conversation IDs

Google Voice uses `?itemId=t.{contact}` URL parameters for conversations (e.g., `t.22905`, `t.%2B12406157696`). There are no data attributes on list items — IDs are extracted by intercepting `history.pushState` on click, which captures the target URL without actually navigating (preserving unread status).

### Unread Detection

- **Conversation level**: Read conversations have `class="... container read ..."` on the clickable element. Unread conversations **lack** the `read` class. There is no `unread` class — it's the absence of `read`.
- **Message level**: Google Voice does not distinguish read/unread at the individual message level in the DOM. Unread status is conversation-level only.
- **`gv_list_sms`**: Supports `filter: "unread"` to return only unread conversations.
- **`gv_read_sms`**: Supports `filter: "unread"` — checks if the conversation is unread first (via `listSms`), returns empty if already read. This avoids opening read conversations unnecessarily.

### Headless Server Setup

Designed for headless Linux servers (no display). Login uses Xvfb (virtual framebuffer) + Chrome remote debugging. The user SSH-tunnels port 9222 to their local machine and uses `chrome://inspect/#devices` to interact with the remote browser.

## Selector Maintenance

When Google Voice changes its DOM and operations start failing, inspect the live page via `chrome://inspect` and update `selectors.ts`. Key selectors to verify:
- `CONVERSATION_ITEM` — the custom element wrapping each conversation in the list
- `CONVERSATION_CLICKABLE` — the clickable container within each item
- `CONVERSATION_CONTACT`, `CONVERSATION_SNIPPET`, `CONVERSATION_TIMESTAMP` — data fields
- `MESSAGE_BUBBLE`, `MESSAGE_TEXT` — individual messages in a conversation view
- `COMPOSE_INPUT`, `SEND_BUTTON` — message composition
