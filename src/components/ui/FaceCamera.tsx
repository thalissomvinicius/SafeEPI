"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import * as faceapi from "@vladmandic/face-api"
import { Loader2, Camera, CheckCircle2, ShieldAlert, UserCheck, Info, Timer, AlertTriangle } from "lucide-react"

interface FaceCameraProps {
  onCapture: (descriptor: Float32Array, imageBase64: string) => void;
  targetDescriptor?: Float32Array;
  onCancel: () => void;
}

export function FaceCamera({ onCapture, targetDescriptor, onCancel }: FaceCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stabilityRef = useRef(0)
  const countdownActiveRef = useRef(false) // Prevents detection loop from resetting countdown
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const matchedDescriptorRef = useRef<Float32Array | null>(null)
  
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
  
  const STABILITY_REQUIRED = 8 // ~2.4s at 300ms
  const COUNTDOWN_SECONDS = 4

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
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    
    ctx.save()
    ctx.translate(600, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 600, 600)
    ctx.restore()
    
    return canvas.toDataURL("image/jpeg", 0.92)
  }, [])

  const captureSuccess = useCallback((descriptor: Float32Array) => {
    const base64 = takeSnapshot()
    if (!base64) return
    
    setStatusText("✓ Captura realizada com sucesso!")
    setCapturedImage(base64)
    stopCamera()
    
    setTimeout(() => {
      onCapture(descriptor, base64)
    }, 600)
  }, [onCapture, stopCamera, takeSnapshot])

  // ── Load AI Models ──
  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = "/models"
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ])
        setIsModelsLoaded(true)
        setStatusText("Modelos carregados.")
      } catch (err) {
        console.error("Erro ao carregar modelos:", err)
        setError("Falha ao carregar inteligência artificial. Verifique os modelos em /public/models.")
      }
    }
    loadModels()
    return () => { stopCamera() }
  }, [stopCamera])

  // ── Start camera when ready ──
  useEffect(() => {
    if (isModelsLoaded && !showInstructions) {
      startCamera()
    }
  }, [isModelsLoaded, showInstructions, startCamera])

  // ── Face detection loop ──
  const handleVideoPlay = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)

    intervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current || !isCameraActive) return

      // If countdown is active, STOP detecting — just let the countdown run
      if (countdownActiveRef.current) return

      const detections = await faceapi.detectSingleFace(
        videoRef.current, 
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
      ).withFaceLandmarks().withFaceDescriptor()

      const ctx = canvasRef.current.getContext('2d')

      if (detections) {
        setWarning(null)
        stabilityRef.current += 1
        setStability(stabilityRef.current)
        
        // Check face quality — low score can mean obstructions (hat, glasses, etc)
        const score = detections.detection.score
        if (score < 0.7) {
          setWarning("Detecção fraca: remova óculos escuros, bonés ou chapéus.")
        }

        // Check face size — too small means too far
        const box = detections.detection.box
        const videoW = videoRef.current.videoWidth
        const faceRatio = box.width / videoW
        if (faceRatio < 0.15) {
          setWarning("Aproxime-se mais da câmera.")
        }

        // Draw detection overlay
        if (ctx) {
          const dims = faceapi.matchDimensions(canvasRef.current, videoRef.current, true)
          const resized = faceapi.resizeResults(detections, dims)
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
          
          const rBox = resized.detection.box
          const cx = rBox.x + rBox.width / 2
          const cy = rBox.y + rBox.height / 2
          const radius = (rBox.width + rBox.height) / 3.5
          const progress = Math.min(stabilityRef.current / STABILITY_REQUIRED, 1)
          
          // Background ring
          ctx.strokeStyle = 'rgba(255,255,255,0.12)'
          ctx.lineWidth = 5
          ctx.beginPath()
          ctx.arc(cx, cy, radius, 0, 2 * Math.PI)
          ctx.stroke()
          
          // Progress ring
          ctx.strokeStyle = progress >= 1 ? '#22c55e' : '#60a5fa'
          ctx.lineWidth = 5
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI)
          ctx.stroke()
          ctx.lineCap = 'butt'
        }

        if (stabilityRef.current >= STABILITY_REQUIRED) {
          if (targetDescriptor) {
            setStatusText("Validando identidade...")
            const distance = faceapi.euclideanDistance(detections.descriptor, targetDescriptor)
            if (distance < 0.55) {
              setIsVerified(true)
              matchedDescriptorRef.current = detections.descriptor
              countdownActiveRef.current = true
              setStatusText("Identidade confirmada! Prepare-se...")
              setCountdown(COUNTDOWN_SECONDS)
            } else {
              setStatusText("Rosto não coincide. Ajuste posição.")
              stabilityRef.current = Math.max(stabilityRef.current - 4, 0)
              setStability(stabilityRef.current)
            }
          } else {
            countdownActiveRef.current = true
            setStatusText("Rosto detectado! Prepare-se...")
            setCountdown(COUNTDOWN_SECONDS)
          }
        } else {
          const pct = Math.round((stabilityRef.current / STABILITY_REQUIRED) * 100)
          setStatusText(`Mantenha o rosto parado... ${pct}%`)
        }
      } else {
        // No face — only reset if countdown is NOT active
        if (!countdownActiveRef.current) {
          stabilityRef.current = 0
          setStability(0)
          setIsVerified(false)
          if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
          setStatusText(targetDescriptor ? "Posicione seu rosto para verificação" : "Posicione seu rosto no centro")
        }
      }
    }, 300)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }

  // ── Countdown timer ──
  useEffect(() => {
    if (countdown !== null && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    } else if (countdown === 0) {
      const doCapture = async () => {
        if (!videoRef.current) return
        const d = await faceapi.detectSingleFace(
          videoRef.current,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })
        ).withFaceLandmarks().withFaceDescriptor()

        if (d) {
          if (targetDescriptor) {
            const distance = faceapi.euclideanDistance(d.descriptor, targetDescriptor)
            if (distance < 0.6) {
              captureSuccess(d.descriptor)
            } else {
              countdownActiveRef.current = false
              setCountdown(null)
              setIsVerified(false)
              stabilityRef.current = 0
              setStability(0)
              setStatusText("Rosto mudou durante a captura. Tente novamente.")
            }
          } else {
            captureSuccess(d.descriptor)
          }
        } else {
          // Face lost at capture moment — retry
          countdownActiveRef.current = false
          setCountdown(null)
          stabilityRef.current = 0
          setStability(0)
          setStatusText("Rosto não detectado no momento da captura. Tente novamente.")
        }
      }
      doCapture()
    }
  }, [countdown, captureSuccess, targetDescriptor])

  // ── INSTRUCTIONS SCREEN ──
  if (showInstructions) {
    return (
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 rounded-2xl sm:rounded-3xl p-5 sm:p-8 flex flex-col items-center justify-center text-center space-y-4 sm:space-y-6 border-2 border-slate-800">
        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-blue-500/20 rounded-full flex items-center justify-center text-blue-400">
          <UserCheck className="w-8 h-8 sm:w-10 sm:h-10" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-white font-black uppercase tracking-tight text-base sm:text-xl">Instruções de Biometria</h3>
          <p className="text-slate-400 text-[11px] sm:text-xs leading-relaxed max-w-[300px]">
            Siga as instruções abaixo para garantir uma captura de qualidade:
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 w-full">
          <div className="bg-slate-800/60 p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-700/50">
            <p className="text-[10px] sm:text-[10px] font-black text-blue-400 uppercase mb-0.5">💡 Iluminação</p>
            <p className="text-[9px] sm:text-[9px] text-slate-400 leading-tight">Fique de frente para a luz. Evite contraluz.</p>
          </div>
          <div className="bg-slate-800/60 p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border border-amber-700/30">
            <p className="text-[10px] sm:text-[10px] font-black text-amber-400 uppercase mb-0.5">🧢 Acessórios</p>
            <p className="text-[9px] sm:text-[9px] text-slate-400 leading-tight">Remova óculos, chapéus, bonés e protetores.</p>
          </div>
          <div className="bg-slate-800/60 p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-700/50">
            <p className="text-[10px] sm:text-[10px] font-black text-green-400 uppercase mb-0.5">📐 Posição</p>
            <p className="text-[9px] sm:text-[9px] text-slate-400 leading-tight">Olhe para a câmera e centralize o rosto.</p>
          </div>
          <div className="bg-slate-800/60 p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-700/50">
            <p className="text-[10px] sm:text-[10px] font-black text-purple-400 uppercase mb-0.5">⏱ Tempo</p>
            <p className="text-[9px] sm:text-[9px] text-slate-400 leading-tight">Fique parado ~4s. Haverá contagem regressiva.</p>
          </div>
        </div>
        
        <div className="bg-amber-900/30 border border-amber-700/40 rounded-xl p-3 w-full">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-300/90 text-left leading-relaxed">
              <strong className="text-amber-300">Atenção:</strong> O sistema pode recusar a captura se detectar bonés, óculos escuros ou iluminação ruim. Remova todos os acessórios antes de iniciar.
            </p>
          </div>
        </div>

        <button 
          onClick={() => setShowInstructions(false)}
          className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[11px] sm:text-xs transition-all shadow-xl shadow-blue-900/20"
        >
          Entendi, Iniciar Câmera
        </button>
        <button onClick={onCancel} className="text-slate-500 text-[10px] font-bold uppercase hover:text-slate-400 active:text-slate-300">Voltar para assinatura manual</button>
      </div>
    )
  }

  // ── CAPTURED IMAGE PREVIEW ──
  if (capturedImage) {
    return (
      <div className="bg-slate-900 rounded-2xl sm:rounded-3xl overflow-hidden relative flex items-center justify-center border-4 border-green-600" style={{ minHeight: '280px', maxHeight: '60vh' }}>
        <img src={capturedImage} alt="Foto capturada" className="w-full h-full object-cover" style={{ maxHeight: '60vh' }} />
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

  // ── CAMERA VIEW ──
  return (
    <div className="bg-slate-900 rounded-2xl sm:rounded-3xl overflow-hidden relative shadow-inner flex items-center justify-center border-2 sm:border-4 border-slate-800" style={{ minHeight: '280px', maxHeight: '65vh' }}>
      {error ? (
        <div className="text-center p-5 sm:p-6 space-y-3 sm:space-y-4">
          <ShieldAlert className="w-10 h-10 sm:w-12 sm:h-12 text-red-500 mx-auto" />
          <p className="text-red-400 font-bold text-[11px] sm:text-xs leading-relaxed max-w-[280px] mx-auto">{error}</p>
          <div className="flex flex-col gap-2">
            <button onClick={() => { setError(null); startCamera(); }} className="bg-slate-800 text-white px-5 py-2.5 sm:px-6 sm:py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 active:bg-slate-600">Tentar Novamente</button>
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
            className={`w-full h-full object-cover transition-opacity duration-500 ${!isCameraActive ? 'opacity-0' : 'opacity-100'}`}
            style={{ transform: 'scaleX(-1)', minHeight: '280px', maxHeight: '65vh' }}
          />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ transform: 'scaleX(-1)' }} />
          
          {/* Circular guide */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[55%] sm:w-[50%] aspect-square rounded-full border-2 border-dashed border-white/10" />
          </div>

          {/* Real-time warning (hat, glasses, too far) */}
          {warning && !countdown && isCameraActive && (
            <div className="absolute top-12 sm:top-14 left-3 right-3 sm:left-4 sm:right-4 flex justify-center pointer-events-none z-20 animate-in fade-in">
              <div className="bg-amber-600/95 text-white px-3 py-2 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-wider flex items-center gap-2 shadow-lg max-w-[90%]">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="leading-tight">{warning}</span>
              </div>
            </div>
          )}

          {/* Countdown overlay */}
          {countdown !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 backdrop-blur-[2px] z-20 gap-3 sm:gap-4">
              <div className={`w-20 h-20 sm:w-28 sm:h-28 rounded-full border-[5px] sm:border-[6px] flex items-center justify-center shadow-2xl transition-all duration-500 ${
                isVerified ? 'border-green-500 bg-green-950/80' : 'border-blue-500 bg-white/90'
              }`}>
                {countdown > 0 ? (
                  <span className={`text-4xl sm:text-5xl font-black ${isVerified ? 'text-green-400' : 'text-slate-800'}`}>{countdown}</span>
                ) : (
                  <Camera className={`w-8 h-8 sm:w-10 sm:h-10 ${isVerified ? 'text-green-400' : 'text-blue-500'}`} />
                )}
              </div>
              <div className="bg-black/70 px-4 py-1.5 sm:px-5 sm:py-2 rounded-full">
                <p className="text-white text-[9px] sm:text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                  <Timer className="w-3 h-3" />
                  {countdown > 0 ? "Fique parado! Capturando em breve..." : "Capturando agora!"}
                </p>
              </div>
              {isVerified && (
                <div className="bg-green-900/80 px-3 sm:px-4 py-1.5 rounded-full border border-green-600/50">
                  <p className="text-green-400 text-[8px] font-black uppercase tracking-widest">✓ Identidade Verificada</p>
                </div>
              )}
            </div>
          )}

          {/* Bottom status bar */}
          <div className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4 bg-black/80 backdrop-blur-md rounded-xl sm:rounded-2xl p-2.5 sm:p-4 flex items-center justify-between z-10 border border-white/10">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              {!isCameraActive ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400 animate-spin flex-shrink-0" />
              ) : statusText.includes("sucesso") ? (
                <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-400 flex-shrink-0" />
              ) : isVerified ? (
                <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-400 flex-shrink-0" />
              ) : stability > 0 ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400 animate-spin flex-shrink-0" />
              ) : (
                <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300 animate-pulse flex-shrink-0" />
              )}
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] sm:text-[10px] font-black text-white uppercase tracking-wider leading-none mb-0.5 truncate">{statusText}</span>
                <span className="text-[7px] sm:text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none">Antares Digital</span>
              </div>
            </div>
            <button 
              onClick={() => { stopCamera(); onCancel(); }}
              className="text-[8px] sm:text-[9px] font-black text-white uppercase tracking-widest border border-white/20 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg sm:rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors flex-shrink-0 ml-2"
            >
              Sair
            </button>
          </div>

          {/* Top hint */}
          {!countdown && isCameraActive && !warning && (
            <div className="absolute top-2 left-2 right-2 sm:top-4 sm:left-4 sm:right-4 flex justify-center pointer-events-none">
              <div className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-full text-[8px] sm:text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 sm:gap-2 shadow-lg ${
                isVerified ? 'bg-green-600/90 text-white' : 'bg-blue-600/90 text-white'
              }`}>
                <Info className="w-3 h-3" />
                {targetDescriptor 
                  ? (isVerified ? "Identidade OK — Posicione-se" : "Verificando identidade...")
                  : "Centralize o rosto e fique parado"
                }
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
