const TOKEN_KEY = "stayra.token"

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

/** Mirrors the server's ProblemDetails: { title, status, code, errors?: { field: [code] } } */
export class ApiError extends Error {
  status: number
  code: string
  errors: Record<string, string[]>
  constructor(status: number, code: string, title: string, errors?: Record<string, string[]>) {
    super(title)
    this.status = status
    this.code = code
    this.errors = errors ?? {}
  }
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(method: string, url: string, body?: unknown, opts?: { form?: boolean; raw?: boolean }): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" }
  const token = tokenStore.get()
  if (token && (url.startsWith("/api/app") || url.startsWith("/api/admin") || url.startsWith("/api/auth"))) {
    headers.Authorization = `Bearer ${token}`
  }
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json"
    payload = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await fetch(url, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again.")
  }

  if (res.status === 401 && (url.startsWith("/api/app") || url.startsWith("/api/admin"))) onUnauthorized?.()
  if (!res.ok) {
    let problem: { title?: string; code?: string; errors?: Record<string, string[]> } = {}
    try {
      problem = await res.json()
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, problem.code ?? `http_${res.status}`, problem.title ?? res.statusText, problem.errors)
  }
  if (opts?.raw) return res as unknown as T
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
  upload: <T>(url: string, form: FormData) => request<T>("POST", url, form),
  download: async (url: string, filename: string) => {
    const res = await request<Response>("GET", url, undefined, { raw: true })
    const blob = await res.blob()
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  },
}

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v))
  const str = s.toString()
  return str ? `?${str}` : ""
}
