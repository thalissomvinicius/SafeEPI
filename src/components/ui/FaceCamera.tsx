"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import * as faceapi from "@vladmandic/face-api"
import { Loader2, Camera, CheckCircle2, ShieldAlert, UserCheck, Info, Timer } from "lucide-react"

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
  
  // More stability frames = more time to position properly
  const STABILITY_REQUIRED = 12 // ~3.6 seconds of stable detection at 300ms interval
  const COUNTDOWN_SECONDS = 5  // 5-second countdown before actual capture

  const stopCamera = useCallback(() => {
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
      setStatusText("Posicione seu rosto no centro do quadro")
    } catch (err: unknown) {
      console.error("Erro ao acessar câmera:", err)
      const msg = err instanceof DOMException && err.name === "NotAllowedError"
        ? "Permissão da câmera foi negada. Acesse as configurações do navegador e permita o uso da câmera."
        : err instanceof DOMException && err.name === "NotFoundError"
        ? "Nenhuma câmera foi encontrada neste dispositivo. Conecte uma webcam e tente novamente."
        : "Erro ao acessar a câmera. Verifique se outro aplicativo está usando a câmera."
      setError(msg)
    }
  }, [])

  /**
   * Takes a high-quality snapshot from the video stream.
   * Captures at the native video resolution and crops to a centered square
   * to avoid stretched/distorted photos.
   */
  const takeSnapshot = useCallback((): string | null => {
    if (!videoRef.current) return null
    const video = videoRef.current
    const vw = video.videoWidth
    const vh = video.videoHeight
    
    // Create a square crop from center of the video (portrait-like)
    const size = Math.min(vw, vh)
    const sx = (vw - size) / 2
    const sy = (vh - size) / 2
    
    const canvas = document.createElement("canvas")
    canvas.width = 600  // Fixed output size for consistency
    canvas.height = 600
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    
    // Mirror the image (selfie mode) and draw the cropped square
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
    
    // Small delay so the user can see the success state
    setTimeout(() => {
      onCapture(descriptor, base64)
    }, 800)
  }, [onCapture, stopCamera, takeSnapshot])

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
        setStatusText("Modelos carregados. Iniciando câmera...")
      } catch (err) {
        console.error("Erro ao carregar modelos:", err)
        setError("Falha ao carregar inteligência artificial. Verifique se os modelos estão na pasta /public/models.")
      }
    }
    loadModels()

    return () => {
      stopCamera()
    }
  }, [stopCamera])

  useEffect(() => {
    if (isModelsLoaded && !showInstructions) {
      startCamera()
    }
  }, [isModelsLoaded, showInstructions, startCamera])

  const handleVideoPlay = () => {
    const interval = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current || !isCameraActive) return

      const detections = await faceapi.detectSingleFace(
        videoRef.current, 
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.6 })
      ).withFaceLandmarks().withFaceDescriptor()

      if (detections) {
        stabilityRef.current += 1
        setStability(stabilityRef.current)
        
        // Draw detection overlay
        const dims = faceapi.matchDimensions(canvasRef.current, videoRef.current, true)
        const resizedDetections = faceapi.resizeResults(detections, dims)
        const ctx = canvasRef.current.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
          
          const box = resizedDetections.detection.box
          const cx = box.x + box.width / 2
          const cy = box.y + box.height / 2
          const radius = (box.width + box.height) / 3.5
          
          // Progress ring
          const progress = Math.min(stabilityRef.current / STABILITY_REQUIRED, 1)
          
          // Background ring
          ctx.strokeStyle = 'rgba(255,255,255,0.15)'
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
            // VERIFICATION mode
            setStatusText("Validando identidade...")
            const distance = faceapi.euclideanDistance(detections.descriptor, targetDescriptor)
            if (distance < 0.55) {
              setIsVerified(true)
              matchedDescriptorRef.current = detections.descriptor
              // Don't capture immediately — start countdown so user can position
              if (countdown === null) {
                setStatusText("Identidade confirmada! Prepare-se para a foto...")
                setCountdown(COUNTDOWN_SECONDS)
              }
            } else {
              setStatusText("Rosto não coincide com o cadastro. Ajuste sua posição.")
              stabilityRef.current = Math.max(stabilityRef.current - 3, 0)
              setStability(stabilityRef.current)
            }
          } else {
            // ENROLLMENT mode
            if (countdown === null) {
              setStatusText("Rosto detectado! Prepare-se para a foto...")
              setCountdown(COUNTDOWN_SECONDS)
            }
          }
        } else {
          const pct = Math.round((stabilityRef.current / STABILITY_REQUIRED) * 100)
          setStatusText(`Mantenha o rosto parado... (${pct}%)`)
        }
      } else {
        // No face detected — reset everything
        if (countdown !== null) {
          setCountdown(null)
        }
        stabilityRef.current = 0
        setStability(0)
        setIsVerified(false)
        matchedDescriptorRef.current = null
        if (canvasRef.current) {
          canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        }
        setStatusText(targetDescriptor ? "Posicione seu rosto para verificação" : "Posicione seu rosto no centro do quadro")
      }
    }, 300) // Slower interval = less erratic, gives time to position

    return () => clearInterval(interval)
  }

  useEffect(() => {
    if (countdown !== null && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    } else if (countdown === 0) {
      // FINAL CAPTURE — do one last detection to get a fresh descriptor
      const doCapture = async () => {
        if (!videoRef.current) return
        const d = await faceapi.detectSingleFace(
          videoRef.current,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
        ).withFaceLandmarks().withFaceDescriptor()

        if (d) {
          // For verification mode, re-validate match
          if (targetDescriptor) {
            const distance = faceapi.euclideanDistance(d.descriptor, targetDescriptor)
            if (distance < 0.55) {
              captureSuccess(d.descriptor)
            } else {
              setCountdown(null)
              setIsVerified(false)
              stabilityRef.current = 0
              setStability(0)
              setStatusText("Rosto mudou durante a contagem. Tente novamente.")
            }
          } else {
            captureSuccess(d.descriptor)
          }
        } else {
          setCountdown(null)
          stabilityRef.current = 0
          setStability(0)
          setStatusText("Rosto perdido durante a captura. Tente novamente.")
        }
      }
      doCapture()
    }
  }, [countdown, captureSuccess, targetDescriptor])

  // ── INSTRUCTIONS SCREEN ──
  if (showInstructions) {
    return (
      <div className="bg-slate-900 rounded-3xl p-8 flex flex-col items-center justify-center text-center space-y-6 aspect-[4/3] border-4 border-slate-800">
        <div className="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center text-blue-400">
          <UserCheck className="w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h3 className="text-white font-black uppercase tracking-tighter text-xl">Instruções de Biometria</h3>
          <p className="text-slate-400 text-xs leading-relaxed max-w-[280px]">
            Para garantir a validade jurídica da entrega, siga as instruções abaixo antes de iniciar:
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 w-full">
          <div className="bg-slate-800/50 p-3 rounded-2xl border border-slate-700/50">
            <p className="text-[10px] font-black text-blue-400 uppercase mb-1">💡 Iluminação</p>
            <p className="text-[9px] text-slate-400">Fique de frente para uma fonte de luz. Evite contraluz.</p>
          </div>
          <div className="bg-slate-800/50 p-3 rounded-2xl border border-slate-700/50">
            <p className="text-[10px] font-black text-amber-400 uppercase mb-1">🧢 Acessórios</p>
            <p className="text-[9px] text-slate-400">Remova óculos escuros, chapéus, bonés e protetores faciais.</p>
          </div>
          <div className="bg-slate-800/50 p-3 rounded-2xl border border-slate-700/50">
            <p className="text-[10px] font-black text-green-400 uppercase mb-1">📐 Posição</p>
            <p className="text-[9px] text-slate-400">Olhe diretamente para a câmera e centralize o rosto.</p>
          </div>
          <div className="bg-slate-800/50 p-3 rounded-2xl border border-slate-700/50">
            <p className="text-[10px] font-black text-purple-400 uppercase mb-1">⏱ Tempo</p>
            <p className="text-[9px] text-slate-400">Fique parado por ~5 segundos. Haverá uma contagem regressiva.</p>
          </div>
        </div>
        <button 
          onClick={() => setShowInstructions(false)}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-xl shadow-blue-900/20"
        >
          Entendi, Iniciar Câmera
        </button>
        <button onClick={onCancel} className="text-slate-500 text-[10px] font-bold uppercase hover:text-slate-400">Voltar para assinatura manual</button>
      </div>
    )
  }

  // ── CAPTURED IMAGE PREVIEW ──
  if (capturedImage) {
    return (
      <div className="bg-slate-900 rounded-3xl overflow-hidden relative aspect-[4/3] flex items-center justify-center border-4 border-green-600">
        <img src={capturedImage} alt="Foto capturada" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4 bg-green-900/90 backdrop-blur-md rounded-2xl p-4 flex items-center gap-3 border border-green-600/50">
          <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0" />
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
    <div className="bg-slate-900 rounded-3xl overflow-hidden relative shadow-inner aspect-[4/3] flex items-center justify-center border-4 border-slate-800">
      {error ? (
        <div className="text-center p-6 space-y-4">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
          <p className="text-red-400 font-bold text-xs leading-relaxed max-w-[260px] mx-auto">{error}</p>
          <div className="flex flex-col gap-2">
            <button onClick={() => { setError(null); startCamera(); }} className="bg-slate-800 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-700">Tentar Novamente</button>
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
            className={`w-full h-full object-cover transition-opacity duration-700 ${!isCameraActive ? 'opacity-0' : 'opacity-100'}`}
            style={{ transform: 'scaleX(-1)' }}
          />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover pointer-events-none" style={{ transform: 'scaleX(-1)' }} />
          
          {/* Circular guide overlay */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[60%] aspect-square rounded-full border-2 border-dashed border-white/15" />
          </div>

          {/* Countdown overlay */}
          {countdown !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 backdrop-blur-[3px] z-20 gap-4">
              <div className={`w-28 h-28 rounded-full border-[6px] flex items-center justify-center shadow-2xl transition-all duration-500 ${
                isVerified 
                  ? 'border-green-500 bg-green-950/80' 
                  : 'border-blue-500 bg-white/90'
              }`}>
                {countdown > 0 ? (
                  <span className={`text-5xl font-black ${isVerified ? 'text-green-400' : 'text-slate-800'}`}>{countdown}</span>
                ) : (
                  <Camera className={`w-10 h-10 ${isVerified ? 'text-green-400' : 'text-blue-500'}`} />
                )}
              </div>
              <div className="bg-black/70 px-5 py-2 rounded-full">
                <p className="text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                  <Timer className="w-3 h-3" />
                  {countdown > 0 ? "Fique parado! Capturando em breve..." : "Capturando agora!"}
                </p>
              </div>
              {isVerified && (
                <div className="bg-green-900/80 px-4 py-1.5 rounded-full border border-green-600/50">
                  <p className="text-green-400 text-[8px] font-black uppercase tracking-widest">✓ Identidade Verificada</p>
                </div>
              )}
            </div>
          )}

          {/* Bottom status bar */}
          <div className="absolute bottom-4 left-4 right-4 bg-black/80 backdrop-blur-md rounded-2xl p-4 flex items-center justify-between z-10 border border-white/10">
            <div className="flex items-center gap-3">
              {!isCameraActive ? (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              ) : statusText.includes("sucesso") || statusText.includes("Concluída") ? (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              ) : isVerified ? (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              ) : stability > 0 ? (
                <div className="relative">
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                </div>
              ) : (
                <Camera className="w-5 h-5 text-slate-300 animate-pulse" />
              )}
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-white uppercase tracking-widest leading-none mb-1">{statusText}</span>
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none">Certificação Antares Digital</span>
              </div>
            </div>
            <button 
              onClick={() => { stopCamera(); onCancel(); }}
              className="text-[9px] font-black text-white uppercase tracking-widest border border-white/20 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
            >
              Sair
            </button>
          </div>

          {/* Top hint */}
          {!countdown && isCameraActive && (
            <div className="absolute top-4 left-4 right-4 flex justify-center pointer-events-none">
              <div className={`px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-2 shadow-lg ${
                isVerified ? 'bg-green-600/90 text-white' : 'bg-blue-600/90 text-white'
              }`}>
                <Info className="w-3 h-3" />
                {targetDescriptor 
                  ? (isVerified ? "Identidade OK — Posicione-se para a foto" : "Verificando sua identidade...")
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
