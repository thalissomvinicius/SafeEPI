const DEFAULT_SUPABASE_ORIGIN = "https://orogyfmlxakoxncmahji.supabase.co"

function resolveSupabaseOrigin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return DEFAULT_SUPABASE_ORIGIN

  try {
    return new URL(url).origin
  } catch {
    return DEFAULT_SUPABASE_ORIGIN
  }
}

function toWebSocketOrigin(origin: string) {
  if (origin.startsWith("https://")) return origin.replace("https://", "wss://")
  if (origin.startsWith("http://")) return origin.replace("http://", "ws://")
  return origin
}

export function buildCspReportOnlyHeader(nonce: string) {
  const supabaseOrigin = resolveSupabaseOrigin()
  const supabaseWsOrigin = toWebSocketOrigin(supabaseOrigin)

  const directives = [
    ["default-src", "'self'"],
    ["script-src", "'self'", `'nonce-${nonce}'`],
    // Necessario hoje por Tailwind/shadcn/Next gerarem estilos inline em runtime.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", supabaseOrigin],
    ["connect-src", "'self'", supabaseOrigin, supabaseWsOrigin, "https://api.ipify.org"],
    ["font-src", "'self'"],
    ["media-src", "'self'", "blob:"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["report-uri", "/api/csp-report"],
  ]

  return directives.map(([directive, ...sources]) => `${directive} ${sources.join(" ")}`).join("; ")
}
