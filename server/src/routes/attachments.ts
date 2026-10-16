import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import express, { Router } from 'express'
import { config } from '../config.ts'
import { db, transaction } from '../db.ts'
import { audit } from '../audit.ts'
import { badRequest, canSeeCategory, forbidden, idParam, me, notFound } from '../http.ts'
import { canEdit, canWork, requireTask, getTask } from './tasks.ts'

export const attachmentsRouter = Router()

mkdirSync(config.uploadsDir, { recursive: true })

const MAX_PER_TASK = 30

type AttachmentRow = {
  id: number
  task_id: number
  uploader_id: number | null
  file: string
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  created_at: number
}

const serializeAttachment = (a: AttachmentRow) => ({
  id: a.id,
  taskId: a.task_id,
  uploaderId: a.uploader_id,
  name: a.name,
  mime: a.mime,
  size: a.size,
  width: a.width,
  height: a.height,
  createdAt: a.created_at,
  url: `/api/attachments/${a.id}`,
})

export function listAttachments(taskId: number) {
  const rows = db.prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY id').all(taskId) as AttachmentRow[]
  return rows.map(serializeAttachment)
}

export function removeFiles(files: string[]) {
  for (const file of files) rmSync(path.join(config.uploadsDir, file), { force: true })
}

/**
 * Detects the image type from its first bytes instead of trusting the client.
 * SVG is deliberately not accepted: it can carry scripts.
 */
export function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: 'image/png', ext: 'png' }
  if (starts(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: 'jpg' }
  if (starts(0x47, 0x49, 0x46, 0x38)) return { mime: 'image/gif', ext: 'gif' }
  if (starts(0x52, 0x49, 0x46, 0x46) && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

function dimension(value: unknown) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : null
}

attachmentsRouter.post(
  '/tasks/:id/attachments',
  express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }),
  (req, res) => {
    const actor = me(req)
    const task = requireTask(req)
    if (!canWork(req, task)) throw forbidden('Only the author, the assignee or an editor can add images')

    const body: unknown = req.body
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Empty upload')
    const type = sniffImage(body)
    if (!type) throw badRequest('Only PNG, JPEG, GIF and WebP images are supported')

    const { n } = db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE task_id = ?').get(task.id) as { n: number }
    if (n >= MAX_PER_TASK) throw badRequest(`A task can have at most ${MAX_PER_TASK} images`)

    let name = 'image'
    try {
      name = decodeURIComponent(String(req.get('x-filename') ?? 'image')).replace(/[\\/\r\n]/g, '_').slice(0, 200) || 'image'
    } catch {
      // malformed header: keep the default name
    }

    const file = `${randomBytes(16).toString('hex')}.${type.ext}`
    writeFileSync(path.join(config.uploadsDir, file), body)

    const id = transaction(() => {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO attachments (task_id, uploader_id, file, name, mime, size, width, height, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(task.id, actor.id, file, name, type.mime, body.length, dimension(req.get('x-width')), dimension(req.get('x-height')), Date.now())
      db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(Date.now(), task.id)
      audit(actor.id, 'task', task.id, 'task.attachment_added', { title: task.title, name })
      return Number(lastInsertRowid)
    })
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow
    res.status(201).json(serializeAttachment(row))
  },
)

attachmentsRouter.get('/attachments/:id', (req, res, next) => {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(idParam(req)) as AttachmentRow | undefined
  if (!row || !canSeeCategory(req, getTask(row.task_id)?.category_id ?? 0)) throw notFound('Image not found')

  const disposition = req.query.download ? 'attachment' : 'inline'
  res.sendFile(path.join(config.uploadsDir, row.file), {
    headers: {
      'Content-Type': row.mime,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'",
    },
  }, (err) => {
    // The row exists but the file is gone (e.g. restored database without uploads).
    if (err && !res.headersSent) next(notFound('Image file is missing on the server'))
  })
})

attachmentsRouter.delete('/attachments/:id', (req, res) => {
  const actor = me(req)
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(idParam(req)) as AttachmentRow | undefined
  const task = row && getTask(row.task_id)
  if (!row || !task || !canSeeCategory(req, task.category_id)) throw notFound('Image not found')
  if (row.uploader_id !== actor.id && !canEdit(req, task)) throw forbidden('You can only remove images you added')

  transaction(() => {
    db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id)
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(Date.now(), task.id)
    audit(actor.id, 'task', task.id, 'task.attachment_removed', { title: task.title, name: row.name })
  })
  removeFiles([row.file])
  res.json({ ok: true })
})
