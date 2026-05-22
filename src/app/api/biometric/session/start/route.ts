import { NextResponse } from "next/server"
import {
  authorizeBiometricAccess,
  callBiometricService,
  enforceBiometricRateLimit,
  isValidBiometricUuid,
} from "@/lib/serverBiometric"

type StartSessionResponse = {
  session_id: string
  state: string
  decision: string
  instruction: string
  progress: number
  challenge_sequence: string[]
  frame_interval_ms: number
}

export async function POST(request: Request) {
  try {
    const limited = enforceBiometricRateLimit(request, "session-start")
    if (limited) return limited

    const formData = await request.formData()
    const employeeId = String(formData.get("employee_id") || "") || null
    const token = String(formData.get("token") || "") || null

    if (employeeId && !isValidBiometricUuid(employeeId)) {
      return NextResponse.json({ error: "ID do colaborador invalido." }, { status: 400 })
    }

    const access = await authorizeBiometricAccess(request, employeeId, token)
    if (!access.ok) return access.response

    const upstream = new FormData()
    upstream.set("mode", String(formData.get("mode") || "verify"))
    upstream.set("require_liveness", String(formData.get("require_liveness") || "false"))
    if (employeeId) upstream.set("employee_id", employeeId)
    if (formData.get("company_id")) upstream.set("company_id", String(formData.get("company_id")))

    const response = await callBiometricService<StartSessionResponse>("/biometric/session/start", upstream)
    return NextResponse.json(response)
  } catch (error) {
    console.error("[/api/biometric/session/start] error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao iniciar sessao biometrica." },
      { status: 500 },
    )
  }
}
