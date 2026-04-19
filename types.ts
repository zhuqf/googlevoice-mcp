export interface SmsMessage {
  conversationId: string
  sender: string
  text: string
  timestamp: string
  isUnread: boolean
  isInbound: boolean
}

export interface SmsConversation {
  conversationId: string
  contact: string
  lastMessage: string
  lastTimestamp: string
  isUnread: boolean
}
