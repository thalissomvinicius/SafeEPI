"use client"

import { useEffect, useRef, useState } from "react"
import * as faceapi from "@vladmandic/face-api"
import { Loader2, Camera, CheckCircle2, ShieldAlert } from "lucide-react"

interface FaceCameraProps {
  onCapture: (descriptor: Float32Array, imageBase64: string) => void;
  targetDescriptor?: Float32Array; // If provided, acts as verification. If not, acts as enrollment.
  onCancel: () => void;
}

export function FaceCamera({ onCapture, targetDescriptor, onCancel }: FaceCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isModelsLoaded, setIsModelsLoaded] = useState(false)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState("Carregando inteligência artificial...")
  const streamRef = useRef<MediaStream | null>(null)

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
        setError("Falha ao carregar inteligência artificial. Verifique sua conexão.")
      }
    }
    loadModels()

    return () => {
      stopCamera()
    }
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } 
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
      }
      setIsCameraActive(true)
      setStatusText("Posicione seu rosto no centro")
    } catch (err) {
      console.error("Erro ao acessar câmera:", err)
      setError("Permissão da câmera negada ou dispositivo não encontrado.")
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setIsCameraActive(false)
  }

  useEffect(() => {
    if (isModelsLoaded) {
      startCamera()
    }
  }, [isModelsLoaded])

  const handleVideoPlay = () => {
    const interval = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current || !isCameraActive) return

      const detections = await faceapi.detectSingleFace(
        videoRef.current, 
        new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
      ).withFaceLandmarks().withFaceDescriptor()

      if (detections) {
        const dims = faceapi.matchDimensions(canvasRef.current, videoRef.current, true)
        const resizedDetections = faceapi.resizeResults(detections, dims)
        canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        faceapi.draw.drawDetections(canvasRef.current, resizedDetections)

        // Verificação vs Cadastro
        if (targetDescriptor) {
          setStatusText("Analisando biometria...")
          const distance = faceapi.euclideanDistance(detections.descriptor, targetDescriptor)
          if (distance < 0.6) { // Limiar seguro
            clearInterval(interval)
            captureSuccess(detections.descriptor)
          } else {
            setStatusText("Rosto não reconhecido! Distância: " + distance.toFixed(2))
          }
        } else {
          // Apenas captura (Cadastro)
          setStatusText("Rosto detectado! Capturando...")
          clearInterval(interval)
          setTimeout(() => captureSuccess(detections.descriptor), 1000)
        }
      } else {
        canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        setStatusText(targetDescriptor ? "Buscando rosto para validação..." : "Posicione seu rosto no centro")
      }
    }, 500)

    return () => clearInterval(interval)
  }

  const captureSuccess = (descriptor: Float32Array) => {
    if (!videoRef.current) return
    setStatusText("Captura bem sucedida!")
    const canvas = document.createElement("canvas")
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0)
    const base64 = canvas.toDataURL("image/jpeg", 0.8)
    stopCamera()
    onCapture(descriptor, base64)
  }

  return (
    <div className="bg-slate-900 rounded-3xl overflow-hidden relative shadow-inner aspect-[4/3] flex items-center justify-center border-4 border-slate-800">
      {error ? (
        <div className="text-center p-6 space-y-4">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
          <p className="text-red-400 font-bold uppercase tracking-widest text-xs">{error}</p>
          <button onClick={onCancel} className="bg-slate-800 text-white px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-700">Voltar</button>
        </div>
      ) : (
        <>
          <video 
            ref={videoRef} 
            autoPlay 
            muted 
            playsInline 
            onPlay={handleVideoPlay}
            className={`w-full h-full object-cover ${!isCameraActive ? 'opacity-0' : 'opacity-100'}`}
          />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
          
          <div className="absolute bottom-4 left-4 right-4 bg-black/60 backdrop-blur-md rounded-2xl p-4 flex items-center justify-between z-10">
            <div className="flex items-center gap-3">
              {!isCameraActive ? (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              ) : statusText.includes("sucesso") ? (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              ) : (
                <Camera className="w-5 h-5 text-slate-300 animate-pulse" />
              )}
              <span className="text-[10px] font-black text-white uppercase tracking-widest">{statusText}</span>
            </div>
            <button 
              onClick={() => { stopCamera(); onCancel(); }}
              className="text-[10px] font-black text-red-400 hover:text-red-300 uppercase tracking-widest border border-red-500/30 px-3 py-1.5 rounded-lg bg-red-500/10"
            >
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  )
}
