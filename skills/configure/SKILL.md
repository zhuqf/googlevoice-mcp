---
name: configure
description: Set up Google Voice — log in via browser, check status, or clear session. Use when user asks to configure Google Voice, log in, check connection, or log out.
user-invocable: true
allowed-tools:
  - Bash(npx playwright install chromium *)
  - Bash(ls *)
  - Bash(rm -rf *)
  - Bash(mkdir *)
  - googlevoice__gv_login
  - googlevoice__gv_check_login
  - mcp__googlevoice__gv_login
  - mcp__googlevoice__gv_check_login
  - Read
  - Write
---

# /googlevoice:configure — Google Voice Setup

Google Voice has no API. This plugin uses Playwright browser automation.
Login requires an interactive browser window for Google's 2FA flow.

**Arguments:** `$ARGUMENTS`

## No arguments — show status

1. Check if browser profile exists at `~/.local/share/openclaw/googlevoice/browser-profile/`
2. Call `gv_login` / `gv_check_login` to verify session
3. Report:
   - If logged in: "Google Voice is connected. You can use gv_list_sms, gv_send_sms, gv_reply_sms, gv_read_sms, and gv_mark_read."
   - If not logged in: "Not connected. Run `/googlevoice:configure login` to set up."

## `login` — interactive login

1. Ensure Playwright Chromium is installed: `npx playwright install chromium`
2. Call `gv_login` — launches system Chromium with remote debugging
3. Tell the user: "System Chrome has launched. To complete login from your local machine:
   1. Set up an SSH tunnel: `ssh -L 9222:localhost:9222 <your-server>`
   2. Open Chrome and go to `chrome://inspect/#devices`
   3. Click 'Configure...' and add `localhost:9222`
   4. Click 'inspect' on the Google Voice target
   5. Complete Google login (including 2FA)
   Let me know when you see the Google Voice Messages page."
4. When the user confirms, call `gv_check_login`
5. If verified: "Google Voice is connected and ready."
6. If not: "Login not detected. Please try again or check if Google Voice is available for your account."

## `logout` — clear session

1. Delete the browser profile: `rm -rf ~/.local/share/openclaw/googlevoice/browser-profile`
2. Confirm: "Google Voice session cleared. Run `/googlevoice:configure login` to reconnect."

## `status` — alias for no-arguments flow

Same as the no-arguments flow above.
