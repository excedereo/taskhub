import type { NextFunction, Request, Response } from 'express'
import { hasPermission, type Permission } from './permissions.ts'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const badRequest = (message: string) => new HttpError(400, message)
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, message)
export const notFound = (what = 'Not found') => new HttpError(404, what)

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Not signed in'))
  next()
}

export function requirePermission(perm: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Not signed in'))
    if (!hasPermission(req.user.permissions, perm)) return next(forbidden())
    next()
  }
}

export function can(req: Request, perm: Permission) {
  return Boolean(req.user && hasPermission(req.user.permissions, perm))
}

/** Category ids the user may see, or null for all. Administrators always see everything. */
export function visibleCategories(req: Request): number[] | null {
  const user = me(req)
  return user.permissions.includes('admin') ? null : user.viewCategoryIds
}

export function canSeeCategory(req: Request, categoryId: number) {
  const ids = visibleCategories(req)
  return ids === null || ids.includes(categoryId)
}

/** `AND <column> IN (...)` for the user's visible categories, or nothing when unrestricted. */
export function visibilityFilter(req: Request, column: string): { sql: string; params: number[] } {
  const ids = visibleCategories(req)
  if (ids === null) return { sql: '', params: [] }
  if (!ids.length) return { sql: ' AND 0', params: [] }
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids }
}

export function me(req: Request) {
  if (!req.user) throw new HttpError(401, 'Not signed in')
  return req.user
}

export function idParam(req: Request, name = 'id') {
  const id = Number(req.params[name])
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound()
  return id
}

type TextOptions = { max: number; min?: number }

export function text(value: unknown, field: string, { max, min = 0 }: TextOptions): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`)
  const v = value.trim()
  if (v.length < min) throw badRequest(min === 1 ? `${field} is required` : `${field} is too short`)
  if (v.length > max) throw badRequest(`${field} must be at most ${max} characters`)
  return v
}

export function oneOf<T extends string>(value: unknown, field: string, options: readonly T[]): T {
  if (!options.includes(value as T)) throw badRequest(`${field} must be one of: ${options.join(', ')}`)
  return value as T
}

export function optionalId(value: unknown, field: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw badRequest(`${field} must be an id or null`)
  return value
}
