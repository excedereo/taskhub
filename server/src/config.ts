import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const rootDir = fileURLToPath(new URL('../../', import.meta.url))

const envFile = path.join(rootDir, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const env = process.env
const publicUrl = (env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

export const config = {
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  publicUrl,
  secureCookies: publicUrl.startsWith('https://'),
  dbPath: path.resolve(rootDir, env.DATABASE_PATH ?? 'data/taskhub.db'),
  webDist: path.join(rootDir, 'web', 'dist'),
  discord: {
    clientId: env.DISCORD_CLIENT_ID ?? '',
    clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
    redirectUri: `${publicUrl}/api/auth/callback`,
  },
  // Lets you sign in with any Discord ID without OAuth. Never enabled in production.
  devLogin: env.DEV_LOGIN === 'true' && env.NODE_ENV !== 'production',
  sessionDays: Number(env.SESSION_DAYS ?? 30),
}

export const discordConfigured = Boolean(config.discord.clientId && config.discord.clientSecret)
