"use client"

// responsive: revisado - mobile-first

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
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
      <div className="w-full overflow-hidden rounded-3xl bg-zinc-950 text-white shadow-2xl">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.05fr_0.95fr] lg:p-8">
          <div className="flex min-h-[360px] flex-col justify-between rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
            <div>
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-600/15 text-red-300 ring-1 ring-red-500/20">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-300">Assinatura facial SafeEPI</p>
              <h3 className="mt-3 text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">{title}</h3>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-300">
                Se o servico biometrico estiver configurado, a identidade sera validada no servidor. Na Vercel Free, o sistema registra uma evidencia facial auditavel sem travar a operacao.
              </p>
            </div>

            <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
              <AlertTriangle className="mr-2 inline h-4 w-4 text-amber-300" />
              Evidencia facial nao e reconhecimento biometrico forte. Ela documenta foto, assinatura, data, IP e contexto operacional.
            </div>
          </div>

          <div className="flex flex-col justify-between gap-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {[
                ["Centralize", "Rosto inteiro dentro do circulo"],
                ["Boa luz", "Evite contraluz e sombras fortes"],
                ["Sem bloqueios", "Nao cubra olhos e nariz"],
              ].map(([heading, text]) => (
                <div key={heading} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-white">{heading}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">{text}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => void startCamera()}
                className="min-h-[52px] w-full rounded-2xl bg-red-600 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white shadow-xl shadow-red-950/30 transition hover:bg-red-700 active:scale-[0.99]"
              >
                Entendi, iniciar camera
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="min-h-[44px] w-full rounded-2xl px-5 py-3 text-xs font-bold uppercase tracking-widest text-zinc-300 transition hover:bg-white/5 hover:text-white"
              >
                {cancelLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full overflow-hidden rounded-3xl bg-zinc-950 text-white shadow-2xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_15%,rgba(220,38,38,0.18),transparent_34%),radial-gradient(circle_at_80%_90%,rgba(22,163,74,0.14),transparent_38%)]" />
      <div className="relative grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(300px,420px)_minmax(0,1fr)] lg:p-7">
        <section className="flex flex-col items-center">
          <div className="mb-4 flex w-full items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-300">{modeLabel}</p>
              <h3 className="text-lg font-black uppercase tracking-tight text-white">{title}</h3>
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="min-h-[40px] rounded-full bg-white/10 px-4 text-xs font-bold text-white transition hover:bg-white/15"
            >
              {cancelLabel}
            </button>
          </div>

          <div className="relative aspect-square w-full max-w-[min(78vw,340px)] sm:max-w-[360px] lg:max-w-[380px]">
            <div className={`absolute inset-0 rounded-full blur-2xl transition ${state === "APPROVED" ? "bg-emerald-500/35" : isEvidenceMode ? "bg-amber-400/25" : "bg-red-600/20"}`} />
            <div className="relative h-full w-full overflow-hidden rounded-full border border-white/15 bg-zinc-900 shadow-2xl">
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className={`h-full w-full scale-x-[-1] object-cover transition-opacity duration-300 ${isCameraReady ? "opacity-100" : "opacity-0"}`}
              />
              {!isCameraReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-300">
                  <Loader2 className="h-8 w-8 animate-spin text-red-400" />
                  <span className="text-xs font-bold uppercase tracking-widest">Preparando camera</span>
                </div>
              )}
              <div className="pointer-events-none absolute inset-5 rounded-full border border-dashed border-white/20" />
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 shadow" />
            </div>
            <div className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-zinc-950/90 px-4 py-2 text-xs font-bold text-zinc-200 shadow-xl backdrop-blur">
              {state === "APPROVED" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : isCapturing || state === "REQUESTING_CAMERA" ? (
                <Loader2 className="h-4 w-4 animate-spin text-red-300" />
              ) : isEvidenceMode ? (
                <Camera className="h-4 w-4 text-amber-300" />
              ) : (
                <Fingerprint className="h-4 w-4 text-red-300" />
              )}
              {scorePercent !== null ? `Confianca ${scorePercent}%` : isEvidenceMode ? "Evidencia facial" : "Sessao segura"}
            </div>
          </div>
        </section>

        <section className="flex min-w-0 flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.06] p-4 sm:p-5">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${state === "APPROVED" ? "bg-emerald-400/15 text-emerald-300" : isEvidenceMode ? "bg-amber-400/15 text-amber-300" : "bg-red-500/15 text-red-300"}`}>
                {state === "APPROVED" ? <UserRoundCheck className="h-6 w-6" /> : isEvidenceMode ? <Camera className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Status da captura</p>
                <p className="text-lg font-semibold leading-snug text-white">{instruction}</p>
              </div>
            </div>

            {isEvidenceMode && (
              <div className="mb-4 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm leading-relaxed text-amber-100">
                <Info className="mr-2 inline h-4 w-4 text-amber-200" />
                Modo sem IA externa: salva foto facial para auditoria. A entrega continua com assinatura, PDF, IP e data.
              </div>
            )}

            {error && <p className="mb-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</p>}

            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-300 ${state === "APPROVED" ? "bg-emerald-400" : isEvidenceMode ? "bg-amber-300" : "bg-red-500"}`}
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ["Foto", isCameraReady ? "ok" : "..."],
                ["Fluxo", isEvidenceMode ? "auditavel" : "biometria"],
                ["Saida", isEvidenceMode ? "sem score" : scorePercent !== null ? `${scorePercent}%` : "..."],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-zinc-950/35 p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</p>
                  <p className="mt-1 truncate text-xs font-bold text-zinc-100">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {isEvidenceMode && !isTerminal && (
              <button
                type="button"
                onClick={() => void captureEvidence()}
                disabled={!isCameraReady || isCapturing}
                className="min-h-[52px] w-full rounded-2xl bg-amber-400 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-zinc-950 shadow-xl shadow-amber-950/20 transition hover:bg-amber-300 disabled:opacity-60"
              >
                {isCapturing ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <CircleDot className="mr-2 inline h-4 w-4" />}
                Registrar evidencia facial
              </button>
            )}

            {isTerminal && state !== "APPROVED" && (
              <button
                type="button"
                onClick={retry}
                className="min-h-[48px] w-full rounded-2xl bg-white px-5 py-3 text-sm font-black uppercase tracking-widest text-zinc-950 transition hover:bg-zinc-100"
              >
                <RotateCcw className="mr-2 inline h-4 w-4" />
                Tentar novamente
              </button>
            )}

            <button
              type="button"
              onClick={handleCancel}
              className="min-h-[44px] w-full rounded-2xl border border-white/10 px-5 py-3 text-xs font-bold uppercase tracking-widest text-zinc-300 transition hover:bg-white/5 hover:text-white"
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
