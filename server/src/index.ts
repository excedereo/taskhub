import dns from 'node:dns'
import { existsSync } from 'node:fs'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import { config, discordConfigured } from './config.ts'
import { db, getSetting } from './db.ts'
import { pruneSessions, sessionMiddleware } from './auth.ts'
import { HttpError, me, requireAuth } from './http.ts'
import { PERMISSIONS } from './permissions.ts'
import { authRouter } from './routes/auth.ts'
import { usersRouter } from './routes/users.ts'
import { rolesRouter } from './routes/roles.ts'
import { categoriesRouter } from './routes/categories.ts'
import { tasksRouter } from './routes/tasks.ts'
import { adminRouter } from './routes/admin.ts'

// Many cheap VPS hosts ship broken IPv6; prefer IPv4 when talking to Discord.
dns.setDefaultResultOrder('ipv4first')

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 'loopback')
app.use(express.json({ limit: '256kb' }))
app.use(cookieParser())
app.use(sessionMiddleware)

const api = express.Router()

api.get('/meta', (_req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  res.json({
    instanceName: getSetting<string>('instance_name'),
    discordConfigured,
    devLogin: config.devLogin,
    needsSetup: count === 0,
    permissions: PERMISSIONS,
  })
})

api.use(authRouter)
api.use(requireAuth)

api.get('/me', (req, res) => {
  res.json(me(req))
})

api.use(usersRouter)
api.use(rolesRouter)
api.use(categoriesRouter)
api.use(tasksRouter)
api.use(adminRouter)

app.use('/api', api)
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown endpoint')))

if (existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')))
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid JSON body' })
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

pruneSessions()
setInterval(pruneSessions, 60 * 60 * 1000).unref()

app.listen(config.port, config.host, () => {
  console.log(`Taskhub listening on http://${config.host}:${config.port} (public URL: ${config.publicUrl})`)
  if (!discordConfigured) console.warn('DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET are not set: Discord sign-in is disabled.')
  if (config.devLogin) console.warn('DEV_LOGIN is on: anyone can sign in as any Discord ID. Do not use this in production.')
})
