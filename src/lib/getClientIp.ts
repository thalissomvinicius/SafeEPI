export function getClientIp(request: Request) {
  const vercelForwardedFor = request.headers.get("x-vercel-forwarded-for")
  const firstVercelIp = vercelForwardedFor?.split(",")[0]?.trim()
  if (firstVercelIp) return firstVercelIp

  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim()
  if (cloudflareIp) return cloudflareIp

  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp

  const forwardedFor = request.headers.get("x-forwarded-for")
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim()
  if (firstForwardedIp) return firstForwardedIp

  return request.headers.get("x-client-ip")?.trim() || "unknown"
}
