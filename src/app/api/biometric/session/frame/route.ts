import { NextResponse } from "next/server"

/** Retired explicitly: a mixed deployment must never fall back to client templates. */
export async function POST(request: Request) {
  void request
  return NextResponse.json({
    code: "FACIAL_PROTOCOL_RETIRED",
    error: "Este protocolo facial foi aposentado. Atualize a página e utilize o novo fluxo de cadastro/verificação ou a assinatura manual.",
  }, { status: 410 })
}
