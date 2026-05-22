import { NextResponse } from "next/server"
import {
  authorizeBiometricAccess,
  callBiometricService,
  enforceBiometricRateLimit,
  isValidBiometricUuid,
  loadEmployeeReferenceEmbedding,
} from "@/lib/serverBiometric"

type FrameResponse = {
  session_id: string
  state: string
  decision: string
  instruction: string
  progress: number
  frame_interval_ms: number
  reason?: string | null
  embedding?: number[] | null
  scores?: unknown
  audit?: unknown
}

function embeddingToFormValue(embedding: number[]) {
  return embedding.map((value) => String(value)).join(",")
}

export async function POST(request: Request) {
  try {
    const limited = enforceBiometricRateLimit(request, "session-frame")
    if (limited) return limited

    const formData = await request.formData()
    const sessionId = String(formData.get("session_id") || "")
    const employeeId = String(formData.get("employee_id") || "") || null
    const token = String(formData.get("token") || "") || null
    const frame = formData.get("frame")
    const mode = String(formData.get("mode") || "verify")

    if (!sessionId) {
      return NextResponse.json({ error: "Sessao biometrica ausente." }, { status: 400 })
    }
    if (!(frame instanceof File)) {
      return NextResponse.json({ error: "Frame da camera ausente." }, { status: 400 })
    }
    if (employeeId && !isValidBiometricUuid(employeeId)) {
      return NextResponse.json({ error: "ID do colaborador invalido." }, { status: 400 })
    }

    const access = await authorizeBiometricAccess(request, employeeId, token)
    if (!access.ok) return access.response

    const upstream = new FormData()
    upstream.set("session_id", sessionId)
    upstream.set("frame", frame, frame.name || "frame.webp")

    if (mode === "verify") {
      if (!employeeId) {
        return NextResponse.json({ error: "Colaborador obrigatorio para verificacao facial." }, { status: 400 })
      }

      const reference = await loadEmployeeReferenceEmbedding(employeeId, access.companyIdScope)
      if (!reference) {
        return NextResponse.json({
          session_id: sessionId,
          state: "FALLBACK_REQUIRED",
          decision: "fallback",
          instruction: "Biometria mestre nao cadastrada. Use assinatura manual auditavel.",
          progress: 70,
          frame_interval_ms: 0,
          reason: "missing_reference_embedding",
        })
      }

      upstream.set("reference_embedding", embeddingToFormValue(reference))
    }

    const response = await callBiometricService<FrameResponse>("/biometric/session/frame", upstream)
    return NextResponse.json(response)
  } catch (error) {
    console.error("[/api/biometric/session/frame] error:", error)
    const serviceUnavailable = error instanceof Error && error.name === "BIOMETRIC_SERVICE_NOT_CONFIGURED"
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao processar biometria.",
        code: serviceUnavailable ? "BIOMETRIC_SERVICE_NOT_CONFIGURED" : "BIOMETRIC_SERVICE_ERROR",
      },
      { status: serviceUnavailable ? 503 : 500 },
    )
  }
}
