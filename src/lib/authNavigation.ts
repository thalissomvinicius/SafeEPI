/** Only allow local application destinations after authentication. */
export function resolvePostLoginRedirect(value?: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/"

  try {
    const base = "https://safeepi.local"
    const target = new URL(value, base)
    const pathname = decodeURIComponent(target.pathname)
    if (target.origin !== base || /^\/(login|api|_next)(\/|$)/i.test(pathname)) return "/"
    if (/%(?:2f|5c)/i.test(target.pathname)) return "/"
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return "/"
  }
}
