import type { SessionUser } from './auth.ts'

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}
