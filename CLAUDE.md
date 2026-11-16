# CLAUDE.md

## Purpose

Local MCP server for one-way SMS to a fixed self destination in Google Voice. The model supplies message text only; the destination is `GOOGLEVOICE_SELF_NUMBER`, and the server requires explicit client elicitation approval before it sends.

## Commands

```bash
npm ci                 # install exactly package-lock.json
npm test               # fixture-only safety checks; no browser/account access
npm run build          # compile checked-out source to dist/
node dist/server.js    # run the checked-out build
```

MCP client configs must launch this checkout's `dist/server.js`, never an unpinned `npx` package. Set `GOOGLEVOICE_SELF_NUMBER` in the server environment to the user's own E.164 number.

## Architecture

- `server.ts` exposes only `gv_login`, `gv_check_login`, and `gv_send_to_self`; inbox reading, replies, mark-read, caller-supplied recipient numbers, and group sends are disabled.
- `server-policy.ts` contains the tool list, serialization queue, and explicit elicitation approval policy; unsupported/canceled prompts fail closed and are tested without a client/browser.
- Every MCP tool operation is serialized.
- `browser.ts` launches system Chrome as a Playwright persistent context over its private control pipe. It does not attach to an existing browser or expose CDP/debugging ports. Page use requires the owned page and exact `https://voice.google.com` origin. Shutdown closes the owned context/process tree.
- `actions.ts` verifies the selected destination and draft before sending, then verifies a newly appearing exact outgoing message in a Google Voice conversation. A post-click failure is uncertain and is never retried automatically.
- `safety.ts` contains pure recipient/thread/message checks. `tests/` covers these plus approval, serialization, and the send workflow using a mocked Playwright page; no real browser/account is used.
- `selectors.ts` isolates Google Voice DOM selectors. Changes to live behavior require careful, manual review; do not use a real account for tests.

## Safety constraints

- Do not add a recipient argument, group-send path, inbox-reading tool, reply tool, or automatic retry without revisiting the security boundary and tests.
- Do not weaken the user approval gate, fixed destination validation, browser ownership/origin checks, or uncertain-outcome handling.
- Never expose browser control over a network listener or delete Chromium profile lock files to force startup. An old detached browser from a previous version must be closed manually before this server uses the same profile.
- Tests/build must not sign in or send SMS. Avoid real-account verification unless the user specifically requests it after reviewing the safety changes.