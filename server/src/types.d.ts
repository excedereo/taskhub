import type { SessionUser } from './auth.ts'

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser
      /** Set when the request was made with a personal API token instead of the browser session. */
      apiToken?: { id: number; name: string; readOnly: boolean }
    }
  }
}
