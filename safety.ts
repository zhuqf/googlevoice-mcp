export const GOOGLE_VOICE_ORIGIN = 'https://voice.google.com'

export function isE164PhoneNumber(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value)
}

function normalizedDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/** Require a visible matching international recipient and reject any other visible phone number. */
export function hasExactRecipientEvidence(bodyText: string, phoneNumber: string): boolean {
  const expected = normalizedDigits(phoneNumber)
  const displayedNumbers = (bodyText.match(/\+\d[\d\s().-]{6,}\d/g) ?? [])
    .map(normalizedDigits)
    .filter(Boolean)
  return isE164PhoneNumber(phoneNumber)
    && bodyText.replace(/\D/g, '').includes(expected)
    && displayedNumbers.length > 0
    && displayedNumbers.every(number => number === expected)
}

/** Accept a thread id only from the exact Google Voice messages page. */
export function verifiedConversationId(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.origin !== GOOGLE_VOICE_ORIGIN || parsed.pathname !== '/u/0/messages') return undefined
    const id = parsed.searchParams.get('itemId') ?? ''
    return /^t\.[\w%+.-]+$/.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

export function isExactOutgoingMessage(expected: string, actual: string, isIncoming: boolean): boolean {
  return !isIncoming && actual.trim() === expected.trim()
}

export function isNewOutgoingMessageCount(previousCount: number, currentCount: number): boolean {
  return currentCount > previousCount
}
