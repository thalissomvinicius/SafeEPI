export function extractBearerToken(value: string | null): string | null {
  if (!value) return null
  const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim())
  return match?.[1] ?? null
}
