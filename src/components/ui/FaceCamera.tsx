"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Loader2, Camera, CheckCircle2, ShieldAlert, UserCheck, Info, Timer, AlertTriangle } from "lucide-react"
import { supabase } from "@/lib/supabase"
// @ts-ignore
import * as faceplugin from "faceplugin-face-recognition-js"
import * as ort from "onnxruntime-web"

// Configura o caminho base para carregar os arquivos .wasm copiados para /public
ort.env.wasm.wasmPaths = "/"

type SuspiciousReason = "repeated_failure" | "low_variance" | "timeout" | "liveness_failed"

interface FaceCameraProps {
  onCapture: (descriptor: number[], imageBase64: string) => void;
  verifyEmployeeId?: string;
  verifyCompanyId?: string | null;
  verifyToken?: string | null;
  requireLiveness?: boolean;
  onCancel: () => void;
  cancelLabel?: string;
}

export function FaceCamera({ onCapture, verifyEmployeeId, verifyCompanyId, verifyToken, requireLiveness, onCancel, cancelLabel = "Voltar para assinatura manual" }: FaceCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stabilityRef = useRef(0)
  const countdownActiveRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const matchedDescriptorRef = useRef<number[] | null>(null)
  const mismatchRef = useRef(0)
  const verificationPendingRef = useRef(false)
  
  const suspiciousLoggedRef = useRef<Record<SuspiciousReason, boolean>>({
    repeated_failure: false,
    low_variance: false,
    timeout: false,
    liveness_failed: false,
  })
  
  const [isModelsLoaded, setIsModelsLoaded] = useState(false)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState("Carregando inteligência artificial...")
  const [countdown, setCountdown] = useState<number | null>(null)
  const [showInstructions, setShowInstructions] = useState(true)
  const [stability, setStability] = useState(0)
  const [isVerified, setIsVerified] = useState(false)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [modelLoadProgress, setModelLoadProgress] = useState(0)
  const [modelLoadLabel, setModelLoadLabel] = useState("Inicializando")
  
  const STABILITY_REQUIRED = 8
  const COUNTDOWN_SECONDS = 4
  const requiresServerVerification = Boolean(verifyEmployeeId)
  const shouldRequireLiveness = requireLiveness ?? requiresServerVerification

  const stopCamera = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setIsCameraActive(false)
  }, [])

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 }, 
          facingMode: "user" 
        } 
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
      }
      setIsCameraActive(true)
      setStatusText("Posicione seu rosto no centro")
    } catch (err: unknown) {
      console.error("Erro ao acessar câmera:", err)
      const msg = err instanceof DOMException && err.name === "NotAllowedError"
        ? "Permissão da câmera foi negada. Acesse as configurações do navegador e permita o uso da câmera para este site."
        : err instanceof DOMException && err.name === "NotFoundError"
        ? "Nenhuma câmera foi encontrada neste dispositivo. Conecte uma webcam ou libere a câmera do celular."
        : "Erro ao acessar a câmera. Verifique se outro aplicativo está usando a câmera e tente novamente."
      setError(msg)
    }
  }, [])

  const takeSnapshot = useCallback((): string | null => {
    if (!videoRef.current) return null
    const video = videoRef.current
    const vw = video.videoWidth
    const vh = video.videoHeight
    
    const size = Math.min(vw, vh)
    const sx = (vw - size) / 2
    const sy = (vh - size) / 2
    
    const canvas = document.createElement("canvas")
    canvas.width = 600
    canvas.height = 600
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return null
    
    ctx.save()
    ctx.translate(600, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 600, 600)
    ctx.restore()
    
    return canvas.toDataURL("image/jpeg", 0.92)
  }, [])

  const captureSuccess = useCallback((descriptor: number[]) => {
    const base64 = takeSnapshot()
    if (!base64) return
    
    setStatusText("✓ Captura realizada com sucesso!")
    setCapturedImage(base64)
    stopCamera()
    
    setTimeout(() => {
      onCapture(descriptor, base64)
    }, 600)
  }, [onCapture, stopCamera, takeSnapshot])

  const logSuspiciousAttempt = useCallback(async (reason: SuspiciousReason, attempts: number) => {
    if (!verifyEmployeeId || suspiciousLoggedRef.current[reason]) return
    suspiciousLoggedRef.current[reason] = true

    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (!verifyToken) {
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    }

    try {
      await fetch("/api/biometric/suspicious-attempt", {
        method: "POST",
        headers,
        body: JSON.stringify({
          employee_id: verifyEmployeeId,
          company_id: verifyCompanyId || null,
          attempts,
          reason,
          ip: "",
          timestamp: new Date().toISOString(),
          token: verifyToken || undefined,
        }),
      })
    } catch (err) {
      console.error("[FaceCamera] suspicious attempt log failed:", err)
    }
  }, [verifyCompanyId, verifyEmployeeId, verifyToken])

  const verifyDescriptor = useCallback(async (descriptor: number[]) => {
    if (!verifyEmployeeId) return { match: true, confidence: 1 }

    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (!verifyToken) {
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    }

    const response = await fetch(`/api/employees/${verifyEmployeeId}/biometric-verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        descriptor,
        token: verifyToken || undefined,
      }),
    })

    const payload = await response.json().catch(() => null) as { match?: boolean; confidence?: number; error?: string } | null
    if (!response.ok) {
      throw new Error(payload?.error || "Falha ao validar biometria.")
    }

    return {
      match: Boolean(payload?.match),
      confidence: typeof payload?.confidence === "number" ? payload.confidence : 0,
    }
  }, [verifyEmployeeId, verifyToken])

  // -- Load Faceplugin Models --
  useEffect(() => {
    const loadModels = async () => {
      try {
        const publicPath = "/faceplugin-models/"
        
        setModelLoadLabel("Detector facial")
        setStatusText("Carregando reconhecimento facial... 10%")
        await faceplugin.loadDetectionModel(publicPath)
        setModelLoadProgress(20)

        setModelLoadLabel("Landmarks")
        setStatusText("Carregando reconhecimento facial... 40%")
        await faceplugin.loadLandmarkModel(publicPath)
        setModelLoadProgress(50)

        setModelLoadLabel("Reconhecimento")
        setStatusText("Carregando reconhecimento facial... 70%")
        await faceplugin.loadFeatureModel(publicPath)
        setModelLoadProgress(80)

        if (shouldRequireLiveness) {
          setModelLoadLabel("Liveness (Vivacidade)")
          setStatusText("Carregando reconhecimento facial... 90%")
          await faceplugin.loadLivenessModel(publicPath)
        }
        
        setModelLoadProgress(100)
        setIsModelsLoaded(true)
        setStatusText("Modelos carregados.")
      } catch (err) {
        console.error("Erro ao carregar modelos do Faceplugin:", err)
        setError("Falha ao carregar inteligência artificial. Verifique os modelos em /public/faceplugin-models.")
      }
    }
    loadModels()
    return () => { stopCamera() }
  }, [stopCamera, shouldRequireLiveness])

  // -- Start camera when ready --
  useEffect(() => {
    if (isModelsLoaded && !showInstructions) {
      const timer = setTimeout(() => {
        void startCamera()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [isModelsLoaded, showInstructions, startCamera])

  // -- Face detection loop --
  const detectionLoopRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    detectionLoopRef.current = async () => {
      if (!videoRef.current || !canvasRef.current || !isCameraActive) return
      if (countdownActiveRef.current || verificationPendingRef.current) return

      try {
        const detections = await faceplugin.detectFace(videoRef.current)
        const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true })

        if (detections && detections.length > 0) {
          const face = detections[0]
          setWarning(null)
          stabilityRef.current += 1
          setStability(stabilityRef.current)
          
          const box = face.rect
          const videoW = videoRef.current.videoWidth
          const faceRatio = box.width / videoW
          if (faceRatio < 0.15) {
            setWarning("Aproxime-se mais da câmera.")
          }

          if (ctx) {
            const canvas = canvasRef.current
            const displayWidth = canvas.clientWidth
            const displayHeight = canvas.clientHeight
            if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
              canvas.width = displayWidth
              canvas.height = displayHeight
            }
            ctx.clearRect(0, 0, canvas.width, canvas.height)

            const scale = Math.max(canvas.width / videoRef.current.videoWidth, canvas.height / videoRef.current.videoHeight)
            const renderedWidth = videoRef.current.videoWidth * scale
            const renderedHeight = videoRef.current.videoHeight * scale
            const offsetX = (canvas.width - renderedWidth) / 2
            const offsetY = (canvas.height - renderedHeight) / 2
            const rBox = box
            const boxX = offsetX + rBox.x * scale
            const boxY = offsetY + rBox.y * scale
            const boxW = rBox.width * scale
            const boxH = rBox.height * scale
            const mirroredX = canvas.width - boxX - boxW
            const cx = mirroredX + boxW / 2
            const cy = boxY + boxH / 2
            const radius = Math.max(boxW, boxH) * 0.62
            const progress = Math.min(stabilityRef.current / STABILITY_REQUIRED, 1)
            
            ctx.strokeStyle = 'rgba(255,255,255,0.12)'
            ctx.lineWidth = 5
            ctx.beginPath()
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI)
            ctx.stroke()
            
            ctx.strokeStyle = progress >= 1 ? '#22c55e' : '#60a5fa'
            ctx.lineWidth = 5
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI)
            ctx.stroke()
            ctx.lineCap = 'butt'
          }

          if (stabilityRef.current >= STABILITY_REQUIRED) {
            countdownActiveRef.current = true
            setStatusText(shouldRequireLiveness ? "Rosto detectado! Analisando..." : "Rosto detectado! Prepare-se...")
            setCountdown(COUNTDOWN_SECONDS)
          } else {
            const pct = Math.round((stabilityRef.current / STABILITY_REQUIRED) * 100)
            setStatusText(`Mantenha o rosto parado... ${pct}%`)
          }
        } else {
          if (!countdownActiveRef.current) {
            stabilityRef.current = 0
            setStability(0)
            setIsVerified(false)
            if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
            setStatusText(requiresServerVerification ? "Posicione seu rosto para verificação" : "Posicione seu rosto no centro")
          }
        }
      } catch (err) {
        console.error("Face detection error:", err)
      }
    }
  })

  const handleVideoPlay = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      void detectionLoopRef.current()
    }, 300)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }

  // -- Countdown timer & Capture Logic --
  useEffect(() => {
    if (countdown !== null && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    } else if (countdown === 0) {
      const doCapture = async () => {
        if (!videoRef.current) return
        try {
          const detections = await faceplugin.detectFace(videoRef.current)
          
          if (detections && detections.length > 0) {
            const face = detections[0]
            const landmarks = await faceplugin.predictLandmark(videoRef.current, face.rect)
            
            if (shouldRequireLiveness) {
              const livenessRes = await faceplugin.predictLiveness(videoRef.current, face.rect)
              if (livenessRes.score < 0.5) {
                countdownActiveRef.current = false
                setCountdown(null)
                setIsVerified(false)
                stabilityRef.current = 0
                setStability(0)
                setWarning("Rosto ao vivo não detectado. Tente em melhor iluminação ou sem óculos.")
                setStatusText("Acesso Negado")
                void logSuspiciousAttempt("liveness_failed", 1)
                return
              }
            }

            const feature = await faceplugin.extractFeature(videoRef.current, face.rect, landmarks)
            const descriptorArray = Array.from(feature) as number[]

            if (requiresServerVerification) {
              verificationPendingRef.current = true
              try {
                const result = await verifyDescriptor(descriptorArray)
                if (result.match) {
                  captureSuccess(descriptorArray)
                } else {
                  countdownActiveRef.current = false
                  setCountdown(null)
                  setIsVerified(false)
                  stabilityRef.current = 0
                  setStability(0)
                  mismatchRef.current += 1
                  setWarning("Rosto não reconhecido. Verifique se é o colaborador correto.")
                  setStatusText("Identidade não confirmada.")
                  if (mismatchRef.current >= 2) {
                    setError("Rosto não reconhecido. A captura foi interrompida porque o rosto não corresponde à biometria cadastrada.")
                  }
                  if (mismatchRef.current >= 3) {
                    void logSuspiciousAttempt("repeated_failure", mismatchRef.current)
                  }
                }
              } catch (err) {
                countdownActiveRef.current = false
                setCountdown(null)
                setIsVerified(false)
                stabilityRef.current = 0
                setStability(0)
                mismatchRef.current += 1
                setWarning(err instanceof Error ? err.message : "Falha ao validar biometria.")
                setStatusText("Identidade não confirmada.")
                if (mismatchRef.current >= 2) {
                  setError("Rosto não reconhecido. A captura foi interrompida porque o rosto não corresponde à biometria cadastrada.")
                }
                if (mismatchRef.current >= 3) {
                  void logSuspiciousAttempt("repeated_failure", mismatchRef.current)
                }
              } finally {
                verificationPendingRef.current = false
              }
            } else {
              captureSuccess(descriptorArray)
            }
          } else {
            countdownActiveRef.current = false
            setCountdown(null)
            stabilityRef.current = 0
            setStability(0)
            setStatusText("Rosto não detectado no momento da captura. Tente novamente.")
          }
        } catch (err) {
          console.error("Capture Error:", err)
          countdownActiveRef.current = false
          setCountdown(null)
          stabilityRef.current = 0
          setStability(0)
          setWarning("Erro ao processar imagem.")
        }
      }
      doCapture()
    }
  }, [countdown, captureSuccess, logSuspiciousAttempt, requiresServerVerification, shouldRequireLiveness, verifyDescriptor])

  // -- INSTRUCTIONS SCREEN --
  if (showInstructions) {
    return (
      <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center text-center space-y-4 sm:space-y-6 border border-slate-200 shadow-xl shadow-slate-200/50">
        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#2563EB]/10 rounded-full flex items-center justify-center text-[#2563EB]">
          <UserCheck className="w-8 h-8 sm:w-10 sm:h-10" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-slate-800 font-black uppercase tracking-tighter text-base sm:text-xl">Instruções de Biometria</h3>
          <p className="text-slate-500 text-[11px] sm:text-xs leading-relaxed max-w-[300px] font-medium">
            Siga as instruções abaixo para garantir uma captura de qualidade:
          </p>
        </div>
        {!isModelsLoaded && (
          <div className="w-full rounded-xl border border-blue-100 bg-blue-50 p-3 text-left">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-700">
                {modelLoadLabel}
              </span>
              <span className="text-[10px] font-black text-blue-700">
                {modelLoadProgress}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${modelLoadProgress}%` }}
              />
            </div>
            <p className="mt-2 text-[10px] font-medium text-blue-700">
              Carregando reconhecimento facial... {modelLoadProgress}%
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:gap-3 w-full">
          <div className="bg-slate-50 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-100 flex flex-col items-center text-center">
            <p className="text-[10px] font-black text-slate-700 uppercase mb-1">Iluminação</p>
            <p className="text-[9px] text-slate-500 leading-tight">Fique de frente para a luz. Evite contraluz.</p>
          </div>
          <div className="bg-slate-50 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-100 flex flex-col items-center text-center">
            <p className="text-[10px] font-black text-slate-700 uppercase mb-1">Acessórios</p>
            <p className="text-[9px] text-slate-500 leading-tight">Remova óculos, chapéus, bonés e protetores.</p>
          </div>
          <div className="bg-slate-50 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-100 flex flex-col items-center text-center">
            <p className="text-[10px] font-black text-slate-700 uppercase mb-1">Posição</p>
            <p className="text-[9px] text-slate-500 leading-tight">Olhe para a câmera e centralize o rosto.</p>
          </div>
          <div className="bg-slate-50 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-100 flex flex-col items-center text-center">
            <p className="text-[10px] font-black text-slate-700 uppercase mb-1">Tempo</p>
            <p className="text-[9px] text-slate-500 leading-tight">Fique parado ~4s. Haverá contagem regressiva.</p>
          </div>
        </div>
        
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 w-full">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-800 text-left leading-relaxed">
              <strong className="text-amber-900">Atenção:</strong> O sistema pode recusar a captura se detectar fotos falsas ou iluminação ruim.
            </p>
          </div>
        </div>

        <button 
          onClick={() => setShowInstructions(false)}
          className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] active:bg-[#501010] text-white py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[11px] sm:text-xs transition-all shadow-lg shadow-[#2563EB]/20"
        >
          Entendi, Iniciar Câmera
        </button>
        <button onClick={onCancel} className="text-[#2563EB] text-[10px] font-bold uppercase hover:underline">{cancelLabel}</button>
      </div>
    )
  }

  // -- CAPTURED IMAGE PREVIEW --
  if (capturedImage) {
    return (
      <div className="bg-slate-900 rounded-2xl sm:rounded-3xl overflow-hidden relative flex items-center justify-center border-4 border-green-600 min-h-[360px] sm:min-h-[420px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={capturedImage} alt="Foto capturada" className="max-h-[70dvh] w-auto max-w-full object-contain" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 sm:bottom-4 sm:left-4 sm:right-4 bg-green-900/90 backdrop-blur-md rounded-xl sm:rounded-2xl p-3 sm:p-4 flex items-center gap-3 border border-green-600/50">
          <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 text-green-400 flex-shrink-0" />
          <div>
            <p className="text-[10px] font-black text-green-400 uppercase tracking-widest">Captura Concluída</p>
            <p className="text-[8px] text-green-300/70 font-bold uppercase tracking-widest">Processando documento...</p>
          </div>
        </div>
      </div>
    )
  }

  // -- CAMERA VIEW --
  return (
    <div className="bg-slate-900 rounded-2xl sm:rounded-3xl overflow-hidden relative shadow-inner flex items-center justify-center border-2 sm:border-4 border-slate-800 face-camera-container">
      {error ? (
        <div className="text-center p-5 sm:p-6 space-y-3 sm:space-y-4">
          <ShieldAlert className="w-10 h-10 sm:w-12 sm:h-12 text-red-500 mx-auto" />
          <p className="text-blue-300 font-bold text-[11px] sm:text-xs leading-relaxed max-w-[280px] mx-auto">{error}</p>
          <div className="flex flex-col gap-2">
            <button onClick={() => { mismatchRef.current = 0; setWarning(null); setError(null); startCamera(); }} className="bg-slate-800 text-white px-5 py-2.5 sm:px-6 sm:py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 active:bg-slate-600">Tentar Novamente</button>
            <button onClick={onCancel} className="text-slate-500 text-[10px] font-bold uppercase hover:text-slate-400">Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <video 
            ref={videoRef} 
            autoPlay 
            muted 
            playsInline 
            onPlay={handleVideoPlay}
            className={`w-full h-full object-cover transition-opacity duration-500 scale-x-[-1] face-camera-video ${!isCameraActive ? 'opacity-0' : 'opacity-100'}`}
          />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none face-camera-mirror" />

          {shouldRequireLiveness && isCameraActive && !countdown && (
            <div className="absolute top-3 left-3 right-3 sm:top-4 sm:left-4 sm:right-4 z-30 flex justify-center pointer-events-none">
              <div className="w-full max-w-sm rounded-2xl border p-3 sm:p-4 shadow-2xl backdrop-blur-md transition-all border-white/15 bg-black/75">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white">
                    <ShieldAlert className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                      Liveness Ativado
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-white">
                      Certifique-se de estar visível na câmera.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {countdown !== null && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-40 animate-in fade-in">
              <span className="text-[120px] font-black text-white drop-shadow-2xl animate-in zoom-in spin-in-12 duration-300">
                {countdown}
              </span>
            </div>
          )}

          <div className="absolute bottom-3 left-3 right-3 sm:bottom-4 sm:left-4 sm:right-4 z-30 pointer-events-none">
            <div className={`backdrop-blur-md rounded-xl sm:rounded-2xl p-3 sm:p-4 border transition-all ${
              warning 
                ? "bg-red-950/90 border-red-500/50" 
                : "bg-slate-900/80 border-slate-700/50"
            }`}>
              {warning ? (
                <div className="flex items-start gap-2 sm:gap-3 text-red-400">
                  <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] sm:text-xs font-bold leading-relaxed">{warning}</p>
                </div>
              ) : (
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700 shadow-inner flex-shrink-0">
                    <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Status da Câmera</p>
                    <p className="text-white text-[11px] sm:text-xs font-bold truncate">
                      {statusText}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="absolute top-2 left-2 pointer-events-none flex items-center gap-1.5 bg-black/30 backdrop-blur-md px-2 py-1 rounded-full border border-white/10">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="text-[8px] font-bold text-white uppercase tracking-widest">
              Liveness: Faceplugin SDK
            </span>
          </div>
        </>
      )}
    </div>
  )
}
