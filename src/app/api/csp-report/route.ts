import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || ""
    const report = contentType.includes("json") || contentType.includes("csp-report")
      ? await request.json()
      : await request.text()

    console.warn("[CSP Report]", typeof report === "string" ? report : JSON.stringify(report))
  } catch (error) {
    console.warn("[CSP Report] Nao foi possivel processar a violacao recebida.", error)
  }

  return new NextResponse(null, { status: 204 })
}
