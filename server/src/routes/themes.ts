import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import express, { Router, type NextFunction, type Request, type Response } from 'express'
import { config } from '../config.ts'
import { db } from '../db.ts'
import { audit } from '../audit.ts'
import { badRequest, idParam, me, notFound, oneOf, requirePermission, text } from '../http.ts'
import { sniffImage } from './attachments.ts'

export const themesRouter = Router()

const COLOR_KEYS = ['bg', 'surface', 'text', 'accent', 'border', 'danger'] as const
const MAX_CSS = 100_000
const MAX_ASSET_MB = 4

type ThemeRow = { id: number; name: string; base: 'light' | 'dark'; colors: string; css: string; created_by: number | null; created_at: number; updated_at: number }

const serialize = (t: ThemeRow) => ({
  id: t.id,
  name: t.name,
  base: t.base,
  colors: JSON.parse(t.colors) as Record<string, string>,
  css: t.css,
  updatedAt: t.updated_at,
})

function parseColors(value: unknown) {
  if (!value || typeof value !== 'object') throw badRequest('Colors are required')
  const out: Record<string, string> = {}
  for (const key of COLOR_KEYS) {
    const v = (value as Record<string, unknown>)[key]
    if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw badRequest(`Color "${key}" must look like #1a2b3c`)
    out[key] = v.toLowerCase()
  }
  return out
}

function parseCss(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw badRequest('CSS must be text')
  if (value.length > MAX_CSS) throw badRequest('CSS is longer than 100 000 characters')
  return value
}

const getTheme = (id: number) => db.prepare('SELECT * FROM themes WHERE id = ?').get(id) as ThemeRow | undefined

/** Everyone signed in can list the workspace themes, so they can pick one. */
themesRouter.get('/themes', (_req, res) => {
  const rows = db.prepare('SELECT * FROM themes ORDER BY name COLLATE NOCASE').all() as ThemeRow[]
  res.json(rows.map(serialize))
})

themesRouter.post('/themes', requirePermission('manage_themes'), (req, res) => {
  const actor = me(req)
  const name = text(req.body?.name, 'Name', { min: 1, max: 40 })
  const base = oneOf(req.body?.base, 'Base', ['light', 'dark'] as const)
  const colors = parseColors(req.body?.colors)
  const css = parseCss(req.body?.css)
  const now = Date.now()
  const { lastInsertRowid } = db.prepare('INSERT INTO themes (name, base, colors, css, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, base, JSON.stringify(colors), css, actor.id, now, now)
  const id = Number(lastInsertRowid)
  audit(actor.id, 'theme', id, 'theme.created', { name })
  res.status(201).json(serialize(getTheme(id)!))
})

themesRouter.patch('/themes/:id', requirePermission('manage_themes'), (req, res) => {
  const actor = me(req)
  const theme = getTheme(idParam(req))
  if (!theme) throw notFound('Theme not found')
  const body = req.body ?? {}
  const next = {
    name: body.name !== undefined ? text(body.name, 'Name', { min: 1, max: 40 }) : theme.name,
    base: body.base !== undefined ? oneOf(body.base, 'Base', ['light', 'dark'] as const) : theme.base,
    colors: body.colors !== undefined ? JSON.stringify(parseColors(body.colors)) : theme.colors,
    css: body.css !== undefined ? parseCss(body.css) : theme.css,
  }
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== theme[k])
  if (changed.length) {
    db.prepare('UPDATE themes SET name = ?, base = ?, colors = ?, css = ?, updated_at = ? WHERE id = ?').run(next.name, next.base, next.colors, next.css, Date.now(), theme.id)
    // The CSS itself can be long, so the log only lists what changed.
    audit(actor.id, 'theme', theme.id, 'theme.updated', { name: next.name, fields: changed })
  }
  res.json(serialize(getTheme(theme.id)!))
})

themesRouter.delete('/themes/:id', requirePermission('manage_themes'), (req, res) => {
  const actor = me(req)
  const theme = getTheme(idParam(req))
  if (!theme) throw notFound('Theme not found')
  db.prepare('DELETE FROM themes WHERE id = ?').run(theme.id)
  audit(actor.id, 'theme', theme.id, 'theme.deleted', { name: theme.name })
  res.status(204).end()
})

/** Images for theme CSS (backgrounds, cursors). They are served from here, which the CSP allows. */
themesRouter.post('/themes/assets', requirePermission('manage_themes'), express.raw({ type: () => true, limit: `${MAX_ASSET_MB}mb` }), (req, res) => {
  const body: unknown = req.body
  if (!Buffer.isBuffer(body) || !body.length) throw badRequest('Empty upload')
  const type = sniffImage(body)
  if (!type) throw badRequest('Use a PNG, JPEG, GIF or WebP image')
  const file = `theme-${randomBytes(8).toString('hex')}.${type.ext}`
  writeFileSync(path.join(config.uploadsDir, file), body)
  res.status(201).json({ url: `/api/theme-assets/${file}` })
})

const ASSET_NAME = /^theme-[0-9a-f]{16}\.(png|jpg|gif|webp)$/
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

/** Public, like the logo: a theme applies on the sign-in page too. */
export function serveThemeAsset(req: Request, res: Response, next: NextFunction) {
  const file = String(req.params.file)
  const match = ASSET_NAME.exec(file)
  if (!match) return next(notFound('No such image'))
  res.sendFile(path.join(config.uploadsDir, file), {
    headers: { 'Content-Type': MIME[match[1]], 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  }, (err) => {
    if (err && !res.headersSent) next(notFound('Image is missing'))
  })
}
