// Google Voice DOM selectors — isolated for easy maintenance when Google changes the UI.
// Verified against live DOM as of 2026-06-15.

export const SELECTORS = {
  // Login state detection
  LOGGED_IN_INDICATOR: '[gv-test-id="sidenav-messages"]',

  // Conversation list (Messages view)
  CONVERSATION_ITEM: 'gv-thread-list-item',
  CONVERSATION_CLICKABLE: '.container',
  CONVERSATION_CONTACT: 'gv-annotation.participants',
  CONVERSATION_SNIPPET: 'gv-annotation.preview',
  CONVERSATION_TIMESTAMP: '.timestamp',
  CONVERSATION_READ_CLASS: 'read',

  // Individual conversation view
  // 2026-06-15: Google renamed the bubble element gv-text-message-item -> gv-message-item
  MESSAGE_BUBBLE: 'gv-message-item',
  MESSAGE_TEXT: '.subject-content-container.bubble',
  MESSAGE_TIMESTAMP: '.sender-timestamp .timestamp',
  MESSAGE_INCOMING: '.incoming',

  // Compose / send
  COMPOSE_INPUT: 'textarea[placeholder="Type a message"], input[placeholder="Type a message"]',
  SEND_BUTTON: 'button[aria-label="Send message"]',

  // New conversation
  NEW_CONVERSATION_BUTTON: '[aria-label="Send new message"]',
  RECIPIENT_INPUT: 'input[placeholder="Type a name or phone number"]',

  // Mark as read (opening conversation usually marks it read)
  MORE_OPTIONS_BUTTON: '[gv-test-id="more-options-button"], button[aria-label="More options"]',
  MARK_READ_OPTION: '[gv-test-id="mark-as-read"], [aria-label="Mark as read"]',
} as const
