"use client"

// responsive: revisado - mobile-first

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Camera,
  CheckCircle2,
  CircleDot,
  Fingerprint,
  Info,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react"
import { supabase } from "@/lib/supabase"

type BiometricDecision = "pending" | "approved" | "retry" | "fallback"
type BiometricState =
  | "INSTRUCTIONS"
  | "REQUESTING_CAMERA"
  | "WAIT_FACE"
  | "QUALITY_CHECK"
  | "CENTER"
  | "TURN_LEFT"
  | "TURN_RIGHT"
  | "MOVE_NEAR"
  | "MOVE_FAR"
  | "BLINK"
  | "VERIFYING"
  | "APPROVED"
  | "RETRY"
  | "FALLBACK_REQUIRED"
  | "ERROR"

type ScoreBundle = {
  spoof: number
  quality: number
  consistency: number
  challenge: number
  context: number
  final: number
}

type StartSessionResponse = {
  session_id: string
  state: BiometricState
  decision: BiometricDecision
  instruction: string
  progress: number
  challenge_sequence: string[]
  frame_interval_ms: number
}

type FrameResponse = {
  session_id: string
  state: BiometricState
  decision: BiometricDecision
  instruction: string
  progress: number
  frame_interval_ms: number
  reason?: string | null
  embedding?: number[] | null
  scores?: ScoreBundle | null
  code?: string
}

type BiometricFetchError = Error & { code?: string; status?: number }

interface FaceCameraProps {
  onCapture: (descriptor: number[], imageBase64: string) => void
  employeeId?: string
  verifyEmployeeId?: string
  verifyCompanyId?: string | null
  verifyToken?: string | null
  requireLiveness?: boolean
  onCancel: () => void
  cancelLabel?: string
}

const MIN_FRAME_INTERVAL_MS = 220
const DEFAULT_FRAME_INTERVAL_MS = 500
const SERVICE_NOT_CONFIGURED = "BIOMETRIC_SERVICE_NOT_CONFIGURED"

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function fetchBiometric<T>(url: string, formData: FormData) {
  const token = await getAccessToken()
  const response = await fetch(url, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.detail || "Falha na biometria facial.") as BiometricFetchError
    error.code = payload?.code
    error.status = response.status
    throw error
  }

  return payload as T
}

function isServiceUnavailable(error: unknown) {
  const err = error as BiometricFetchError
  return err?.code === SERVICE_NOT_CONFIGURED || err?.status === 503
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function canvasToBlob(canvas: HTMLCanvasElement, type: "image/webp" | "image/jpeg", quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("Nao foi possivel gerar a imagem da camera."))
    }, type, quality)
  })
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("Nao foi possivel ler a imagem capturada."))
    reader.readAsDataURL(blob)
  })
}

export function FaceCamera({
  onCapture,
  employeeId,
  verifyEmployeeId,
  verifyCompanyId,
  verifyToken,
  requireLiveness,
  onCancel,
  cancelLabel = "Voltar para assinatura manual",
}: FaceCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const scheduleFrameRef = useRef<(delayMs: number) => void>(() => {})
  const runningRef = useRef(false)
  const finalizingRef = useRef(false)
  const lastFrameBlobRef = useRef<Blob | null>(null)

  const [state, setState] = useState<BiometricState>("INSTRUCTIONS")
  const [instruction, setInstruction] = useState("Siga as instrucoes para registrar a foto facial")
  const [progress, setProgress] = useState(0)
  const [scores, setScores] = useState<ScoreBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [isEvidenceMode, setIsEvidenceMode] = useState(false)

  const mode = verifyEmployeeId ? "verify" : "enroll"
  const targetEmployeeId = verifyEmployeeId || employeeId
  const shouldRequireLiveness = requireLiveness ?? Boolean(verifyEmployeeId)

  const title = useMemo(() => {
    if (state === "APPROVED") return isEvidenceMode ? "Evidencia registrada" : "Identidade confirmada"
    if (state === "RETRY") return "Vamos tentar de novo"
    if (state === "FALLBACK_REQUIRED") return "Use o fallback auditavel"
    if (state === "ERROR") return "Camera indisponivel"
    if (isEvidenceMode) return "Evidencia facial"
    if (mode === "verify") return "Verificacao facial"
    return "Cadastro facial"
  }, [isEvidenceMode, mode, state])

  const modeLabel = isEvidenceMode ? "Modo Vercel Free" : mode === "verify" ? "Biometria server-side" : "Cadastro facial"
  const scorePercent = scores ? Math.round(scores.final * 100) : null
  const isTerminal = state === "APPROVED" || state === "RETRY" || state === "FALLBACK_REQUIRED" || state === "ERROR"

  const stopCamera = useCallback(() => {
    runningRef.current = false
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setIsCameraReady(false)
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  const captureFrame = useCallback(async (maxWidth = 900) => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error("Camera ainda nao esta pronta.")
    }

    const scale = Math.min(1, maxWidth / video.videoWidth)
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))

    const context = canvas.getContext("2d")
    if (!context) throw new Error("Canvas da camera indisponivel.")
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    try {
      return await canvasToBlob(canvas, "image/webp", 0.84)
    } catch {
      return await canvasToBlob(canvas, "image/jpeg", 0.86)
    }
  }, [])

  const buildSessionForm = useCallback(() => {
    const formData = new FormData()
    formData.set("mode", mode)
    formData.set("require_liveness", shouldRequireLiveness ? "true" : "false")
    if (targetEmployeeId) formData.set("employee_id", targetEmployeeId)
    if (verifyCompanyId) formData.set("company_id", verifyCompanyId)
    if (verifyToken) formData.set("token", verifyToken)
    return formData
  }, [mode, shouldRequireLiveness, targetEmployeeId, verifyCompanyId, verifyToken])

  const buildFrameForm = useCallback((blob: Blob) => {
    const formData = new FormData()
    if (sessionIdRef.current) formData.set("session_id", sessionIdRef.current)
    formData.set("frame", blob, `safeepi-facial-${Date.now()}.webp`)
    formData.set("mode", mode)
    formData.set("require_liveness", shouldRequireLiveness ? "true" : "false")
    if (targetEmployeeId) formData.set("employee_id", targetEmployeeId)
    if (verifyCompanyId) formData.set("company_id", verifyCompanyId)
    if (verifyToken) formData.set("token", verifyToken)
    return formData
  }, [mode, shouldRequireLiveness, targetEmployeeId, verifyCompanyId, verifyToken])

  const finalizeCapture = useCallback(async (embedding: number[] | null | undefined, evidenceOnly = false) => {
    if (finalizingRef.current) return
    finalizingRef.current = true
    setState("APPROVED")
    setInstruction(evidenceOnly ? "Foto facial registrada para auditoria." : "Tudo certo. Finalizando captura...")
    setProgress(100)

    const blob = lastFrameBlobRef.current ?? await captureFrame(1080)
    const imageBase64 = await blobToDataUrl(blob)
    stopCamera()
    onCapture(evidenceOnly ? [] : embedding ?? [], imageBase64)
  }, [captureFrame, onCapture, stopCamera])

  const enterEvidenceMode = useCallback(() => {
    runningRef.current = false
    sessionIdRef.current = null
    setIsEvidenceMode(true)
    setError(null)
    setScores(null)
    setState("CENTER")
    setProgress(68)
    setInstruction("Centralize o rosto e registre a evidencia facial.")
  }, [])

  const scheduleFrame = useCallback((delayMs: number) => {
    if (!runningRef.current || finalizingRef.current) return
    const safeDelay = Math.max(MIN_FRAME_INTERVAL_MS, delayMs || DEFAULT_FRAME_INTERVAL_MS)
    timerRef.current = window.setTimeout(async () => {
      if (!runningRef.current || finalizingRef.current) return
      try {
        setIsCapturing(true)
        const blob = await captureFrame()
        lastFrameBlobRef.current = blob
        const response = await fetchBiometric<FrameResponse>("/api/biometric/session/frame", buildFrameForm(blob))

        setState(response.state)
        setInstruction(response.instruction)
        setProgress(clampProgress(response.progress))
        setScores(response.scores ?? null)
        setError(null)

        if (response.decision === "approved") {
          await finalizeCapture(response.embedding)
          return
        }

        if (response.decision === "fallback" || response.state === "FALLBACK_REQUIRED") {
          runningRef.current = false
          setState("FALLBACK_REQUIRED")
          setProgress(clampProgress(response.progress || 70))
          return
        }

        if (response.decision === "retry" || response.state === "RETRY") {
          runningRef.current = false
          setState("RETRY")
          setProgress(clampProgress(response.progress || 60))
          return
        }

        scheduleFrameRef.current(response.frame_interval_ms)
      } catch (err) {
        if (isServiceUnavailable(err)) {
          enterEvidenceMode()
          return
        }
        runningRef.current = false
        setState("ERROR")
        setError(err instanceof Error ? err.message : "Falha ao processar a biometria.")
      } finally {
        setIsCapturing(false)
      }
    }, safeDelay)
  }, [buildFrameForm, captureFrame, enterEvidenceMode, finalizeCapture])

  useEffect(() => {
    scheduleFrameRef.current = scheduleFrame
  }, [scheduleFrame])

  const startCamera = useCallback(async () => {
    try {
      setError(null)
      setScores(null)
      setIsEvidenceMode(false)
      finalizingRef.current = false
      setProgress(2)
      setState("REQUESTING_CAMERA")
      setInstruction("Solicitando permissao da camera...")

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 1280 },
        },
        audio: false,
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      setIsCameraReady(true)

      try {
        const session = await fetchBiometric<StartSessionResponse>("/api/biometric/session/start", buildSessionForm())
        sessionIdRef.current = session.session_id
        runningRef.current = true
        finalizingRef.current = false
        setState(session.state)
        setInstruction(session.instruction)
        setProgress(clampProgress(session.progress))
        scheduleFrame(session.frame_interval_ms)
      } catch (err) {
        if (!isServiceUnavailable(err)) throw err
        enterEvidenceMode()
      }
    } catch (err) {
      stopCamera()
      setState("ERROR")
      setError(err instanceof Error ? err.message : "Nao foi possivel iniciar a camera.")
      setInstruction("Verifique a permissao da camera e tente novamente.")
    }
  }, [buildSessionForm, enterEvidenceMode, scheduleFrame, stopCamera])

  const captureEvidence = useCallback(async () => {
    try {
      setIsCapturing(true)
      lastFrameBlobRef.current = await captureFrame(1080)
      await finalizeCapture([], true)
    } catch (err) {
      setState("ERROR")
      setError(err instanceof Error ? err.message : "Nao foi possivel registrar a evidencia facial.")
    } finally {
      setIsCapturing(false)
    }
  }, [captureFrame, finalizeCapture])

  const retry = useCallback(() => {
    stopCamera()
    sessionIdRef.current = null
    lastFrameBlobRef.current = null
    finalizingRef.current = false
    setScores(null)
    setError(null)
    void startCamera()
  }, [startCamera, stopCamera])

  const handleCancel = useCallback(() => {
    stopCamera()
    onCancel()
  }, [onCancel, stopCamera])

  if (state === "INSTRUCTIONS") {
    return (
      <div className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-xl shadow-slate-200/70">
        <div className="flex min-h-[280px] flex-col justify-between p-4 sm:min-h-[340px] sm:p-7">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700 ring-1 ring-red-100 sm:h-16 sm:w-16">
              <ShieldCheck className="h-7 w-7 sm:h-8 sm:w-8" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-700">SafeEPI</p>
            <h3 className="mt-2 text-xl font-black uppercase tracking-tight text-slate-950 sm:text-2xl">{title}</h3>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-500">
              Centralize o rosto em boa luz. A camera ocupa a proxima tela.
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => void startCamera()}
              className="min-h-[52px] w-full rounded-2xl bg-red-700 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-red-900/20 transition hover:bg-red-800 active:scale-[0.99]"
            >
              Iniciar camera
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="min-h-[44px] w-full rounded-2xl px-5 py-3 text-xs font-bold uppercase tracking-widest text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-xl shadow-slate-200/70">
      <div className="relative grid gap-3 p-3 sm:gap-5 sm:p-5 lg:grid-cols-[minmax(360px,1fr)_320px] lg:p-6">
        <section className="flex flex-col items-center rounded-[1.4rem] bg-slate-50 p-3 sm:p-5">
          <div className="mb-3 flex w-full items-center justify-between gap-3 sm:mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-700">{modeLabel}</p>
              <h3 className="text-sm font-black uppercase tracking-tight text-slate-950 sm:text-lg">{title}</h3>
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="min-h-[40px] shrink-0 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              {cancelLabel}
            </button>
          </div>

          <div className="relative aspect-square w-full max-w-[min(82vw,360px)] sm:max-w-[430px] lg:max-w-[500px]">
            <div className={`absolute inset-0 rounded-full blur-2xl transition ${state === "APPROVED" ? "bg-emerald-400/35" : isEvidenceMode ? "bg-amber-300/30" : "bg-red-300/25"}`} />
            <div className={`relative h-full w-full overflow-hidden rounded-full border-[6px] bg-slate-900 shadow-2xl transition ${state === "APPROVED" ? "border-emerald-300" : isEvidenceMode ? "border-amber-200" : "border-white"}`}>
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className={`h-full w-full scale-x-[-1] object-cover transition-opacity duration-300 ${isCameraReady ? "opacity-100" : "opacity-0"}`}
              />
              {!isCameraReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-200">
                  <Loader2 className="h-8 w-8 animate-spin text-red-300" />
                  <span className="text-xs font-bold uppercase tracking-widest">Preparando camera</span>
                </div>
              )}
              <div className="pointer-events-none absolute inset-5 rounded-full border border-dashed border-white/35" />
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 shadow" />
            </div>
            <div className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs font-bold text-slate-700 shadow-xl backdrop-blur">
              {state === "APPROVED" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : isCapturing || state === "REQUESTING_CAMERA" ? (
                <Loader2 className="h-4 w-4 animate-spin text-red-600" />
              ) : isEvidenceMode ? (
                <Camera className="h-4 w-4 text-amber-600" />
              ) : (
                <Fingerprint className="h-4 w-4 text-red-700" />
              )}
              {scorePercent !== null ? `Confianca ${scorePercent}%` : isEvidenceMode ? "Evidencia facial" : "Sessao segura"}
            </div>
          </div>
        </section>

        <section className="flex min-w-0 flex-col justify-between gap-3 rounded-[1.4rem] border border-slate-200 bg-white p-3 sm:p-5">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl sm:h-12 sm:w-12 ${state === "APPROVED" ? "bg-emerald-50 text-emerald-700" : isEvidenceMode ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>
                {state === "APPROVED" ? <UserRoundCheck className="h-6 w-6" /> : isEvidenceMode ? <Camera className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Status da captura</p>
                <p className="text-sm font-semibold leading-snug text-slate-900 sm:text-base">{instruction}</p>
              </div>
            </div>

            {isEvidenceMode && (
              <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 sm:text-sm">
                <Info className="mr-2 inline h-4 w-4 text-amber-600" />
                Modo sem IA externa: salva foto facial para auditoria. A entrega continua com assinatura, PDF, IP e data.
              </div>
            )}

            {error && <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-300 ${state === "APPROVED" ? "bg-emerald-500" : isEvidenceMode ? "bg-amber-400" : "bg-red-700"}`}
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="mt-3 hidden grid-cols-3 gap-2 sm:grid">
              {[
                ["Foto", isCameraReady ? "ok" : "..."],
                ["Fluxo", isEvidenceMode ? "auditavel" : "biometria"],
                ["Saida", isEvidenceMode ? "sem score" : scorePercent !== null ? `${scorePercent}%` : "..."],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                  <p className="mt-1 truncate text-xs font-bold text-slate-800">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="sticky bottom-0 -mx-3 -mb-3 flex flex-col gap-2.5 border-t border-slate-200 bg-white/95 p-3 backdrop-blur sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
            {isEvidenceMode && !isTerminal && (
              <button
                type="button"
                onClick={() => void captureEvidence()}
                disabled={!isCameraReady || isCapturing}
                className="min-h-[52px] w-full rounded-2xl bg-red-700 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-red-900/20 transition hover:bg-red-800 disabled:opacity-60"
              >
                {isCapturing ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <CircleDot className="mr-2 inline h-4 w-4" />}
                Tirar foto
              </button>
            )}

            {isTerminal && state !== "APPROVED" && (
              <button
                type="button"
                onClick={retry}
                className="min-h-[48px] w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black uppercase tracking-widest text-white transition hover:bg-slate-800"
              >
                <RotateCcw className="mr-2 inline h-4 w-4" />
                Tentar novamente
              </button>
            )}

            <button
              type="button"
              onClick={handleCancel}
              className="min-h-[44px] w-full rounded-2xl border border-slate-200 px-5 py-3 text-xs font-bold uppercase tracking-widest text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            >
              {isEvidenceMode ? "Usar assinatura manual" : "Usar fallback auditavel"}
            </button>
          </div>
        </section>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  )
}
