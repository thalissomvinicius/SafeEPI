const STORAGE_OBJECT_MARKER = "/storage/v1/object/"

export function shouldRequestSignedStorageUrl(
  value: unknown,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): value is string {
  if (typeof value !== "string") return false

  const normalized = value.trim()
  if (!normalized || normalized.startsWith("data:") || normalized.startsWith("blob:") || normalized.startsWith("/")) {
    return false
  }

  try {
    const assetUrl = new URL(normalized)
    if (!supabaseUrl) return false

    const configuredOrigin = new URL(supabaseUrl).origin
    return assetUrl.origin === configuredOrigin && assetUrl.pathname.includes(STORAGE_OBJECT_MARKER)
  } catch {
    // Referencias novas ficam salvas como caminho relativo dentro do bucket.
    return true
  }
}
