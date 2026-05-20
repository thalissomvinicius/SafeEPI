export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim()
  if (firstForwardedIp) return firstForwardedIp

  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-client-ip") ||
    "unknown"
  )
}
