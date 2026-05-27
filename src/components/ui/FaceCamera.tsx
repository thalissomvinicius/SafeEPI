"use client"

// ui: câmera/assinatura redesenhada — mobile-first ✓

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import {
  CircleDot,
  Info,
  Loader2,
  RotateCcw,
  ShieldCheck,
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

async function fetchBiometric<T>(url: string, formData: FormData, timeoutMs = 8000) {
  const token = await getAccessToken()
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
      signal: controller.signal,
    })
  } catch (error) {
    const requestError = new Error(error instanceof DOMException && error.name === "AbortError"
      ? "Servico biometrico demorou para responder."
      : "Falha ao conectar com a biometria facial.") as BiometricFetchError
    requestError.code = SERVICE_NOT_CONFIGURED
    requestError.status = 503
    throw requestError
  } finally {
    window.clearTimeout(timeout)
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.detail || "Falha na biometria facial.") as BiometricFetchError
    error.code = payload?.code
    error.status = response.status
    throw error
  }

  return payload as T
}

function waitForVideoElement(ref: RefObject<HTMLVideoElement | null>, timeoutMs = 3000) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const startedAt = Date.now()
    const tick = () => {
      if (ref.current) {
        resolve(ref.current)
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("Tela da camera nao ficou pronta. Tente novamente."))
        return
      }
      window.requestAnimationFrame(tick)
    }
    tick()
  })
}

function waitForLoadedMetadata(video: HTMLVideoElement, timeoutMs = 4000) {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error("A camera abriu, mas nao enviou imagem. Feche outros apps que usam camera e tente novamente."))
    }, timeoutMs)

    const onLoaded = () => {
      cleanup()
      resolve()
    }

    const cleanup = () => {
      window.clearTimeout(timeout)
      video.removeEventListener("loadedmetadata", onLoaded)
      video.removeEventListener("canplay", onLoaded)
    }

    video.addEventListener("loadedmetadata", onLoaded, { once: true })
    video.addEventListener("canplay", onLoaded, { once: true })
  })
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
  const [loadingLabel, setLoadingLabel] = useState("Camera")

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
  const hasFaceSignal = isCameraReady && (isEvidenceMode || progress >= 45 || state === "APPROVED")

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
      setLoadingLabel("Permissao da camera")
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
      setProgress(18)
      setInstruction("Abrindo imagem da camera...")

      const video = await waitForVideoElement(videoRef)
      video.setAttribute("playsinline", "true")
      video.setAttribute("webkit-playsinline", "true")
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      await video.play().catch(() => undefined)
      await waitForLoadedMetadata(video)

      setIsCameraReady(true)
      setProgress(34)
      setLoadingLabel("Servico biometrico")
      setInstruction("Preparando verificacao facial...")

      try {
        const session = await fetchBiometric<StartSessionResponse>("/api/biometric/session/start", buildSessionForm(), 6000)
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
      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-xl shadow-slate-200/70">
        <div className="flex min-h-[260px] flex-col justify-between p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:min-h-[340px] sm:p-7">
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
    <div className="relative w-full min-w-0 max-w-full overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-xl shadow-slate-200/70">
      <div className="flex max-h-[calc(100dvh-0.75rem)] min-h-[calc(100dvh-0.75rem)] flex-col gap-3 overflow-y-auto overscroll-contain p-3 sm:max-h-none sm:min-h-0 sm:overflow-visible sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-700">{modeLabel}</p>
            <h3 className="truncate text-base font-black uppercase tracking-tight text-slate-950 sm:text-lg">{title}</h3>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="min-h-[44px] max-w-[46%] shrink-0 truncate rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-100 sm:max-w-none sm:px-4"
          >
            {cancelLabel}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 sm:p-3">
          <div className="mb-2 rounded-2xl bg-white/90 px-3 py-2 text-center text-sm font-semibold text-slate-800 shadow-sm">
            {instruction}
          </div>

          {error && <p className="mb-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-900 shadow-inner sm:aspect-video">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className={`h-full w-full touch-none scale-x-[-1] object-cover transition-opacity duration-300 ${isCameraReady ? "opacity-100" : "opacity-0"}`}
            />

            {!isCameraReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950 text-white">
                <Loader2 className="h-8 w-8 animate-spin text-red-300" />
                <div className="w-full max-w-[260px] px-4 text-center">
                  <p className="text-sm font-black uppercase tracking-widest">{loadingLabel}</p>
                  <p className="mt-1 text-sm text-slate-300">{progress}%</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
                    <div className="h-full rounded-full bg-red-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              </div>
            )}

            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`h-[72%] w-[54%] rounded-[50%] border-2 transition-all duration-300 ${
                  state === "RETRY" || state === "ERROR"
                    ? "border-red-400 shadow-[0_0_0_999px_rgba(15,23,42,0.18)]"
                    : hasFaceSignal
                      ? "animate-pulse border-emerald-300 shadow-[0_0_26px_rgba(16,185,129,0.55),0_0_0_999px_rgba(15,23,42,0.14)]"
                      : "border-white/80 shadow-[0_0_0_999px_rgba(15,23,42,0.2)]"
                }`}
              />
            </div>

            <div className="absolute bottom-3 left-3 right-3 rounded-full bg-white/90 p-1.5 shadow-lg backdrop-blur">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    state === "RETRY" || state === "ERROR" ? "bg-red-600" : state === "APPROVED" || hasFaceSignal ? "bg-emerald-500" : "bg-red-700"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white px-3 py-2 text-sm shadow-sm">
            <span className="font-semibold text-slate-700">
              {scorePercent !== null ? `Confianca ${scorePercent}%` : isEvidenceMode ? "Foto auditavel" : "Verificacao ativa"}
            </span>
            <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-widest ${hasFaceSignal ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {hasFaceSignal ? "ao vivo" : "aguarde"}
            </span>
          </div>

          {isEvidenceMode && (
            <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-800">
              <Info className="mr-2 inline h-4 w-4 text-amber-600" />
              Salvaremos uma foto facial para auditoria junto da assinatura, IP e data.
            </div>
          )}
        </div>

        <div className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2.5 border-t border-slate-200 bg-white/95 px-0 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
          {isEvidenceMode && !isTerminal && (
            <button
              type="button"
              onClick={() => void captureEvidence()}
              disabled={!isCameraReady || isCapturing}
              className="min-h-[56px] w-full rounded-2xl bg-red-700 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-red-900/20 transition hover:bg-red-800 disabled:opacity-60"
            >
              {isCapturing ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <CircleDot className="mr-2 inline h-4 w-4" />}
              Capturar foto
            </button>
          )}

          {isTerminal && state !== "APPROVED" && (
            <button
              type="button"
              onClick={retry}
              className="min-h-[52px] w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black uppercase tracking-widest text-white transition hover:bg-slate-800"
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

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  )
}
