import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import express, { Router, type NextFunction, type Request, type Response } from 'express'
import { config } from '../config.ts'
import { getSetting, setSetting, transaction } from '../db.ts'
import { audit } from '../audit.ts'
import { badRequest, me, notFound, requirePermission } from '../http.ts'
import { removeFiles, sniffImage } from './attachments.ts'

export const logoRouter = Router()

type Logo = { file: string; mime: string; version: number }

const MAX_LOGO_MB = 2

/** URL for the current logo, versioned so browsers pick up a new one immediately. */
export function logoUrl() {
  const logo = getSetting<Logo | null>('logo')
  return logo ? `/api/logo?v=${logo.version}` : null
}

/** Public on purpose: the sign-in page shows the logo before anyone is signed in. */
export function serveLogo(_req: Request, res: Response, next: NextFunction) {
  const logo = getSetting<Logo | null>('logo')
  if (!logo) return next(notFound('No logo'))
  res.sendFile(path.join(config.uploadsDir, logo.file), {
    headers: {
      'Content-Type': logo.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  }, (err) => {
    if (err && !res.headersSent) next(notFound('Logo file is missing'))
  })
}

logoRouter.post('/settings/logo', requirePermission('manage_settings'), express.raw({ type: () => true, limit: `${MAX_LOGO_MB}mb` }), (req, res) => {
  const actor = me(req)
  const body: unknown = req.body
  if (!Buffer.isBuffer(body) || !body.length) throw badRequest('Empty upload')
  const type = sniffImage(body)
  if (!type) throw badRequest('Use a PNG, JPEG, GIF or WebP image')

  const previous = getSetting<Logo | null>('logo')
  const file = `logo-${randomBytes(8).toString('hex')}.${type.ext}`
  writeFileSync(path.join(config.uploadsDir, file), body)
  transaction(() => {
    setSetting('logo', { file, mime: type.mime, version: Date.now() } satisfies Logo)
    audit(actor.id, 'settings', null, 'settings.updated', { changes: { logo: [Boolean(previous), true] } })
  })
  if (previous) removeFiles([previous.file])
  res.json({ logoUrl: logoUrl() })
})

logoRouter.delete('/settings/logo', requirePermission('manage_settings'), (req, res) => {
  const actor = me(req)
  const previous = getSetting<Logo | null>('logo')
  if (previous) {
    transaction(() => {
      setSetting('logo', null)
      audit(actor.id, 'settings', null, 'settings.updated', { changes: { logo: [true, false] } })
    })
    removeFiles([previous.file])
  }
  res.json({ logoUrl: null })
})
