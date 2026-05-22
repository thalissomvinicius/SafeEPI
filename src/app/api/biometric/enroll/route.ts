import { NextResponse } from "next/server"
import {
  authorizeBiometricAccess,
  callBiometricService,
  enforceBiometricRateLimit,
} from "@/lib/serverBiometric"

type EnrollResponse = {
  embedding: number[]
  quality: number
  instruction: string
}

export async function POST(request: Request) {
  try {
    const limited = enforceBiometricRateLimit(request, "enroll")
    if (limited) return limited

    const formData = await request.formData()
    const frame = formData.get("frame")
    const token = String(formData.get("token") || "") || null
    const employeeId = String(formData.get("employee_id") || "") || null

    if (!(frame instanceof File)) {
      return NextResponse.json({ error: "Imagem obrigatoria." }, { status: 400 })
    }

    const access = await authorizeBiometricAccess(request, employeeId, token)
    if (!access.ok) return access.response

    const upstream = new FormData()
    upstream.set("frame", frame, frame.name || "enroll.webp")

    const response = await callBiometricService<EnrollResponse>("/biometric/enroll", upstream)
    return NextResponse.json(response)
  } catch (error) {
    console.error("[/api/biometric/enroll] error:", error)
    const serviceUnavailable = error instanceof Error && error.name === "BIOMETRIC_SERVICE_NOT_CONFIGURED"
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao gerar cadastro facial.",
        code: serviceUnavailable ? "BIOMETRIC_SERVICE_NOT_CONFIGURED" : "BIOMETRIC_SERVICE_ERROR",
      },
      { status: serviceUnavailable ? 503 : 500 },
    )
  }
}
