// Google Voice DOM selectors used only by login checks and fixed-destination self-send.
export const SELECTORS = {
  LOGGED_IN_INDICATOR: '[gv-test-id="sidenav-messages"]',
  MESSAGE_BUBBLE: 'gv-text-message-item',
  MESSAGE_TEXT: '.subject-content-container.bubble',
  MESSAGE_INCOMING: '.incoming',
  COMPOSE_INPUT: 'textarea[placeholder="Type a message"], input[placeholder="Type a message"]',
  SEND_BUTTON: 'button[aria-label="Send message"]',
  NEW_CONVERSATION_BUTTON: '[aria-label="Send new message"]',
  RECIPIENT_INPUT: 'input[placeholder="Type a name or phone number"]',
  RECIPIENT_SUGGESTION: '.send-to-label',
} as const