const WA_USER_SUFFIX = '@s.whatsapp.net'

/**
 * Normalize an E.164 phone (e.g. "+201234567890") OR an existing JID into a WhatsApp user JID.
 * A value that already contains "@" is assumed to be a JID (user or group) and passed through.
 */
export function toUserJid(input: string): string {
  const trimmed = input.trim()
  if (trimmed.includes('@')) return trimmed
  const digits = trimmed.replace(/\D+/g, '')
  return `${digits}${WA_USER_SUFFIX}`
}

/** Extract the bare digits from a JID ("201...:12@s.whatsapp.net" -> "201..."). */
export function jidDigits(jid: string): string {
  const user = jid.split('@')[0] ?? ''
  return user.split(':')[0] ?? ''
}
