/** Preview is deliberately read-only while it shares the production database. */
export const PREVIEW_READ_ONLY_MESSAGE = "Versão de testes em modo consulta. Alterações e envios ficam disponíveis quando houver um banco de testes separado."

export function isPreviewReadOnly() {
  // VERCEL_ENV is trusted on the server. The public flag is fixed by next.config
  // during the build so the browser can also prevent direct Supabase writes.
  return process.env.VERCEL_ENV === "preview" || process.env.NEXT_PUBLIC_SAFE_EPI_READ_ONLY === "true"
}

export function isBlockedPreviewAppRequest(pathname: string, method: string) {
  if (!isPreviewReadOnly()) return false
  if (pathname.startsWith("/api/cron/") || pathname.startsWith("/api/fingerprint/agent")) return true
  const normalizedMethod = method.toUpperCase()
  if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) return false
  return !(normalizedMethod === "POST" && ["/api/auth/login", "/api/storage/signed-url"].includes(pathname))
}

const READ_RPC_NAMES = new Set(["safeepi_dashboard_delivery_buckets", "safeepi_notification_summary"])

export function isReadOnlySupabaseRequest(input: RequestInfo | URL, init?: RequestInit) {
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null
  const method = (init?.method || request?.method || "GET").toUpperCase()
  const url = new URL(request?.url || String(input))
  const path = url.pathname.replace(/\/+$/, "")

  if (path.startsWith("/auth/v1/")) {
    if (["GET", "HEAD"].includes(method)) {
      return ["/auth/v1/user", "/auth/v1/settings", "/auth/v1/.well-known/jwks.json", "/auth/v1/admin/users"].includes(path)
        || /^\/auth\/v1\/admin\/users\/[^/]+$/.test(path)
    }
    // Logging out of the preview must not revoke the operator's production
    // sessions against the shared Auth backend.
    return method === "POST" && (path === "/auth/v1/token"
      || (path === "/auth/v1/logout" && url.searchParams.get("scope") === "local"))
  }

  if (path.startsWith("/rest/v1/rpc/")) {
    return ["GET", "HEAD", "POST"].includes(method) && READ_RPC_NAMES.has(path.slice("/rest/v1/rpc/".length))
  }

  if (method === "POST" && /^\/storage\/v1\/object\/(sign|list)\//.test(path)) return true
  return ["GET", "HEAD", "OPTIONS"].includes(method)
}

export function previewReadOnlyResponse() {
  return new Response(JSON.stringify({ error: PREVIEW_READ_ONLY_MESSAGE, code: "PREVIEW_READ_ONLY" }), {
    status: 403,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}

export function createPreviewSafeFetch(fetcher: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    if (isPreviewReadOnly() && !isReadOnlySupabaseRequest(input, init)) {
      return Promise.resolve(previewReadOnlyResponse())
    }
    return fetcher(input, init)
  }
}
