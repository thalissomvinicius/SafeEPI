"use client"

// responsive: revisado — mobile-first ✓

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
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
}

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

const MIN_FRAME_INTERVAL_MS = 200
const DEFAULT_FRAME_INTERVAL_MS = 500

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
    const message = payload?.error || payload?.detail || "Falha na biometria facial."
    throw new Error(message)
  }

  return payload as T
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
  const [instruction, setInstruction] = useState("Siga as instrucoes para confirmar sua identidade")
  const [progress, setProgress] = useState(0)
  const [scores, setScores] = useState<ScoreBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)

  const mode = verifyEmployeeId ? "verify" : "enroll"
  const targetEmployeeId = verifyEmployeeId || employeeId
  const shouldRequireLiveness = requireLiveness ?? Boolean(verifyEmployeeId)

  const title = useMemo(() => {
    if (state === "APPROVED") return "Identidade confirmada"
    if (state === "RETRY") return "Vamos tentar de novo"
    if (state === "FALLBACK_REQUIRED") return "Valide por outro metodo"
    if (state === "ERROR") return "Camera indisponivel"
    if (mode === "verify") return "Verificacao facial"
    return "Cadastro facial"
  }, [mode, state])

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

  const captureFrame = useCallback(async (maxWidth = 720) => {
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
      return await canvasToBlob(canvas, "image/webp", 0.82)
    } catch {
      return await canvasToBlob(canvas, "image/jpeg", 0.84)
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
    formData.set("frame", blob, `safeepi-biometric-${Date.now()}.webp`)
    formData.set("mode", mode)
    formData.set("require_liveness", shouldRequireLiveness ? "true" : "false")
    if (targetEmployeeId) formData.set("employee_id", targetEmployeeId)
    if (verifyCompanyId) formData.set("company_id", verifyCompanyId)
    if (verifyToken) formData.set("token", verifyToken)
    return formData
  }, [mode, shouldRequireLiveness, targetEmployeeId, verifyCompanyId, verifyToken])

  const finalizeCapture = useCallback(async (embedding: number[] | null | undefined) => {
    if (finalizingRef.current) return
    finalizingRef.current = true
    setState("APPROVED")
    setInstruction("Tudo certo. Finalizando captura...")
    setProgress(100)

    const blob = lastFrameBlobRef.current ?? await captureFrame(960)
    const imageBase64 = await blobToDataUrl(blob)
    stopCamera()
    onCapture(embedding ?? [], imageBase64)
  }, [captureFrame, onCapture, stopCamera])

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
        runningRef.current = false
        setState("ERROR")
        setError(err instanceof Error ? err.message : "Falha ao processar a biometria.")
      } finally {
        setIsCapturing(false)
      }
    }, safeDelay)
  }, [buildFrameForm, captureFrame, finalizeCapture])

  useEffect(() => {
    scheduleFrameRef.current = scheduleFrame
  }, [scheduleFrame])

  const startCamera = useCallback(async () => {
    try {
      setError(null)
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

      const session = await fetchBiometric<StartSessionResponse>("/api/biometric/session/start", buildSessionForm())
      sessionIdRef.current = session.session_id
      runningRef.current = true
      finalizingRef.current = false

      setIsCameraReady(true)
      setState(session.state)
      setInstruction(session.instruction)
      setProgress(clampProgress(session.progress))
      scheduleFrame(session.frame_interval_ms)
    } catch (err) {
      stopCamera()
      setState("ERROR")
      setError(err instanceof Error ? err.message : "Nao foi possivel iniciar a camera.")
      setInstruction("Verifique a permissao da camera e tente novamente")
    }
  }, [buildSessionForm, scheduleFrame, stopCamera])

  const retry = useCallback(() => {
    stopCamera()
    sessionIdRef.current = null
    lastFrameBlobRef.current = null
    finalizingRef.current = false
    setScores(null)
    void startCamera()
  }, [startCamera, stopCamera])

  const handleCancel = useCallback(() => {
    stopCamera()
    onCancel()
  }, [onCancel, stopCamera])

  const scorePercent = scores ? Math.round(scores.final * 100) : null
  const isTerminal = state === "APPROVED" || state === "RETRY" || state === "FALLBACK_REQUIRED" || state === "ERROR"

  if (state === "INSTRUCTIONS") {
    return (
      <div className="w-full overflow-hidden rounded-3xl bg-zinc-950 text-white shadow-2xl">
        <div className="px-5 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto flex max-w-xl flex-col items-center text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-600/15 text-red-400 ring-1 ring-red-500/20">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-300">Assinatura facial SafeEPI</p>
            <h3 className="mt-2 text-xl font-black uppercase tracking-tight text-white">{title}</h3>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-300">
              A camera envia fotos compactadas para validacao segura no servidor. Mantenha o rosto centralizado, em boa luz e sem cobrir os olhos.
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["Centralize", "Olhe para a camera"],
              ["Boa luz", "Evite contraluz forte"],
              ["Sem bloqueios", "Retire o que cobrir olhos e rosto"],
            ].map(([heading, text]) => (
              <div key={heading} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-white">{heading}</p>
                <p className="mt-1 text-xs text-zinc-400">{text}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-xs text-amber-100">
            <AlertTriangle className="mr-2 inline h-4 w-4 text-amber-300" />
            Validade operacional: se a biometria falhar por camera, luz ou internet, use o fallback auditavel.
          </div>

          <div className="mt-6 flex flex-col gap-3">
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
    )
  }

  return (
    <div className="relative w-full overflow-hidden rounded-3xl bg-zinc-950 text-white shadow-2xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(22,163,74,0.18),transparent_38%),radial-gradient(circle_at_50%_90%,rgba(220,38,38,0.14),transparent_42%)]" />
      <div className="relative p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-300">SafeEPI biometria</p>
            <h3 className="text-base font-black uppercase tracking-tight text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="min-h-[40px] rounded-full bg-white/10 px-4 text-xs font-bold text-white transition hover:bg-white/15"
          >
            {cancelLabel}
          </button>
        </div>

        <div className="mx-auto flex max-w-md flex-col items-center">
          <div className="relative aspect-square w-full max-w-[320px]">
            <div className={`absolute inset-0 rounded-full blur-2xl transition ${state === "APPROVED" ? "bg-emerald-500/35" : "bg-red-600/20"}`} />
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
              <div className="pointer-events-none absolute inset-4 rounded-full border border-dashed border-white/20" />
            </div>
            <div className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-zinc-950/90 px-4 py-2 text-xs font-bold text-zinc-200 shadow-xl backdrop-blur">
              {state === "APPROVED" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : isCapturing || state === "REQUESTING_CAMERA" ? (
                <Loader2 className="h-4 w-4 animate-spin text-red-300" />
              ) : (
                <Camera className="h-4 w-4 text-red-300" />
              )}
              {scorePercent !== null ? `Confianca ${scorePercent}%` : "Sessao segura"}
            </div>
          </div>

          <div className="mt-8 w-full rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-red-300">
              {state === "APPROVED" ? <UserRoundCheck className="h-6 w-6 text-emerald-400" /> : <Sparkles className="h-6 w-6" />}
            </div>
            <p className={`text-lg font-semibold ${state === "APPROVED" ? "text-emerald-300" : "text-white"}`}>
              {instruction}
            </p>
            {error && <p className="mt-2 text-sm text-red-200">{error}</p>}
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-300 ${state === "APPROVED" ? "bg-emerald-400" : "bg-red-500"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {isTerminal && state !== "APPROVED" && (
            <div className="mt-4 flex w-full flex-col gap-3">
              <button
                type="button"
                onClick={retry}
                className="min-h-[48px] w-full rounded-2xl bg-white px-5 py-3 text-sm font-black uppercase tracking-widest text-zinc-950 transition hover:bg-zinc-100"
              >
                <RotateCcw className="mr-2 inline h-4 w-4" />
                Tentar novamente
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="min-h-[44px] w-full rounded-2xl border border-white/10 px-5 py-3 text-xs font-bold uppercase tracking-widest text-zinc-300 transition hover:bg-white/5 hover:text-white"
              >
                Usar fallback auditavel
              </button>
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  )
}
