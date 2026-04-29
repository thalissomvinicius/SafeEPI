export function generateAuditCode(prefix?: string, length = 12) {
  const bytes = new Uint8Array(Math.ceil(length / 2))

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    const fallback = `${Date.now()}${Math.random()}`
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = fallback.charCodeAt(index % fallback.length)
    }
  }

  const code = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length)
    .toUpperCase()

  return prefix ? `${prefix}-${code}` : code
}
