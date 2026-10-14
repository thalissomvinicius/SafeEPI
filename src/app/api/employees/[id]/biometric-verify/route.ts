import { NextResponse } from "next/server"

/** Browser descriptors never constitute a server-authoritative biometric proof. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  void request
  void context
  return NextResponse.json({
    code: "FACIAL_PROTOCOL_RETIRED",
    error: "Este protocolo facial foi aposentado. Atualize a página e utilize o novo fluxo de verificação ou a assinatura manual.",
  }, { status: 410, headers: { "Cache-Control": "no-store" } })
}
