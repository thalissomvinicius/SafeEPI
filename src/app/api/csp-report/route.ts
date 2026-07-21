import { NextResponse } from "next/server"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"

export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`csp-report:ip:${getClientIp(request)}`, 30, 60 * 1000)
    if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

    const report = await readJsonWithLimit<unknown>(request, 32 * 1024)
    console.warn("[CSP Report]", JSON.stringify(report).slice(0, 2048))
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return new NextResponse(null, { status: error.status })
    }
    console.warn("[CSP Report] Nao foi possivel processar a violacao recebida.", error)
  }

  return new NextResponse(null, { status: 204 })
}
