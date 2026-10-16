import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { config, discordConfigured } from '../config.ts'
import { endSession, signIn, startSession, type DiscordProfile } from '../auth.ts'
import { badRequest, notFound, text } from '../http.ts'

export const authRouter = Router()

const STATE_COOKIE = 'taskhub_oauth_state'
const stateCookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/api/auth' } as const

authRouter.get('/auth/login', (_req, res) => {
  if (!discordConfigured) return res.redirect('/login?error=not_configured')

  const state = randomBytes(16).toString('hex')
  res.cookie(STATE_COOKIE, state, { ...stateCookieOptions, maxAge: 10 * 60 * 1000 })

  const url = new URL('https://discord.com/oauth2/authorize')
  url.search = new URLSearchParams({
    client_id: config.discord.clientId,
    response_type: 'code',
    redirect_uri: config.discord.redirectUri,
    scope: 'identify',
    state,
    prompt: 'none',
  }).toString()
  res.redirect(url.toString())
})

authRouter.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query
  const expected: unknown = req.cookies?.[STATE_COOKIE]
  res.clearCookie(STATE_COOKIE, stateCookieOptions)

  if (typeof code !== 'string' || typeof state !== 'string' || state !== expected) {
    return res.redirect('/login?error=state')
  }

  let profile: DiscordProfile
  try {
    profile = await fetchDiscordProfile(code)
  } catch (err) {
    console.error('Discord sign-in failed:', err)
    return res.redirect('/login?error=discord')
  }

  const result = signIn(profile)
  if ('error' in result) return res.redirect(`/login?error=${result.error}`)
  startSession(res, result.userId)
  res.redirect('/')
})

async function fetchDiscordProfile(code: string): Promise<DiscordProfile> {
  const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.discord.redirectUri,
    }),
  })
  if (!tokenRes.ok) throw new Error(`token exchange: ${tokenRes.status} ${await tokenRes.text()}`)
  const { access_token } = (await tokenRes.json()) as { access_token: string }

  const userRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  if (!userRes.ok) throw new Error(`users/@me: ${userRes.status}`)
  const user = (await userRes.json()) as { id: string; username: string; global_name: string | null; avatar: string | null }

  return { id: user.id, username: user.username, displayName: user.global_name ?? user.username, avatar: user.avatar }
}

// Local development only: sign in as any Discord ID without going through OAuth.
authRouter.post('/auth/dev', (req, res) => {
  if (!config.devLogin) throw notFound()
  const discordId = text(req.body?.discordId, 'Discord ID', { min: 1, max: 20 })
  if (!/^\d{5,20}$/.test(discordId)) throw badRequest('Discord ID must be numeric')
  const name = text(req.body?.name ?? `dev-${discordId.slice(-4)}`, 'Name', { min: 1, max: 32 })

  const result = signIn({ id: discordId, username: name.toLowerCase().replace(/\s+/g, '_'), displayName: name, avatar: null })
  if ('error' in result) return res.status(403).json({ error: result.error })
  startSession(res, result.userId)
  res.json({ ok: true })
})

authRouter.post('/auth/logout', (req, res) => {
  endSession(req, res)
  res.json({ ok: true })
})
