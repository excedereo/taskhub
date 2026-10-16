import { AsyncLocalStorage } from 'node:async_hooks'

/** Per-request facts that deep code (like the audit log) needs without passing them everywhere. */
export type RequestContext = { via?: string }

export const requestContext = new AsyncLocalStorage<RequestContext>()
