import type { Me, User } from './types.ts'

export function displayName(u: Pick<User, 'displayName' | 'username' | 'discordId'> | undefined | null) {
  if (!u) return 'Unknown user'
  return u.displayName ?? u.username ?? u.discordId
}

export function avatarUrl(u: Pick<User | Me, 'discordId' | 'avatar'>, size = 64) {
  if (!u.avatar) return null
  const ext = u.avatar.startsWith('a_') ? 'gif' : 'png'
  // Discord's CDN only serves power-of-two sizes (16…4096); anything else is a 400 and the avatar falls back to a letter.
  const cdnSize = Math.min(4096, Math.max(16, 2 ** Math.ceil(Math.log2(size))))
  return `https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.${ext}?size=${cdnSize}`
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

export function timeAgo(ts: number) {
  const seconds = (ts - Date.now()) / 1000
  if (Math.abs(seconds) < 45) return 'just now'
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(Math.round(seconds / 60), 'minute')
}

const dtf = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
export const formatDate = (ts: number) => dtf.format(ts)

/** Mirrors the server rule: you can only hand out permissions you hold yourself. */
export function covers(granted: readonly string[], requested: readonly string[]) {
  return granted.includes('admin') || requested.every((p) => granted.includes(p))
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}
