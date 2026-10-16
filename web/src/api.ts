export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const UNAUTHORIZED_EVENT = 'taskhub:unauthorized'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && path !== '/me') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, data.error ?? res.statusText)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return null
  }
}

/** Uploads one image as the raw request body; dimensions go along so the gallery can lay out before images load. */
export async function uploadImage<T>(taskId: number, file: File): Promise<T> {
  if (!IMAGE_TYPES.includes(file.type)) throw new ApiError(400, `${file.name}: only PNG, JPEG, GIF and WebP are supported`)
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, `${file.name} is larger than 10 MB`)
  const size = await imageSize(file)
  const headers: Record<string, string> = { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name || 'image') }
  if (size) {
    headers['X-Width'] = String(size.width)
    headers['X-Height'] = String(size.height)
  }
  const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', headers, body: file, credentials: 'same-origin' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText)
  return data as T
}

/** Image files from a paste or drop, ignoring text and other content. */
export function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return []
  const files: File[] = []
  for (const item of Array.from<File | DataTransferItem>(list)) {
    const file = item instanceof File ? item : item.kind === 'file' ? item.getAsFile() : null
    if (file && file.type.startsWith('image/')) files.push(file)
  }
  return files
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')
