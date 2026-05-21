"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import * as faceapi from "@vladmandic/face-api"
import { Loader2, Camera, CheckCircle2, ShieldAlert, UserCheck, Info, Timer, AlertTriangle, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react"
import { supabase } from "@/lib/supabase"

type LivenessChallenge = "turn_right" | "turn_left" | "look_up"
type SuspiciousReason = "repeated_failure" | "low_variance" | "timeout"

const LIVENESS_TIMEOUT_MS = 10_000
const LOW_VARIANCE_THRESHOLD = 0.001
const MODEL_STEPS = [
  { label: "Detector facial", weight: 0.02, load: () => faceapi.nets.tinyFaceDetector.loadFromUri("/models") },
  { label: "Landmarks", weight: 0.05, load: () => faceapi.nets.faceLandmark68Net.loadFromUri("/models") },
  { label: "Reconhecimento", weight: 0.93, load: () => faceapi.nets.faceRecognitionNet.loadFromUri("/models") },
]

const LIVENESS_CHALLENGES: Record<LivenessChallenge, { label: string; Icon: typeof ArrowRight }> = {
  turn_right: { label: "Vire levemente para a direita", Icon: ArrowRight },
  turn_left: { label: "Vire levemente para a esquerda", Icon: ArrowLeft },
  look_up: { label: "Olhe brevemente para cima", Icon: ArrowUp },
}

function pickChallenge(previous?: LivenessChallenge): LivenessChallenge {
  const options = (Object.keys(LIVENESS_CHALLENGES) as LivenessChallenge[])
    .filter(item => item !== previous)
  return options[Math.floor(Math.random() * options.length)] || "turn_right"
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface FaceCameraProps {
  onCapture: (descriptor: Float32Array, imageBase64: string) => void;
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
  const countdownActiveRef = useRef(false) // Prevents detection loop from resetting countdown
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const matchedDescriptorRef = useRef<Float32Array | null>(null)
  const mismatchRef = useRef(0)
  const verificationPendingRef = useRef(false)
  const challengeBaselineRef = useRef<{ eyebrowEyeDistance?: number } | null>(null)
  const challengeTimeoutCountRef = useRef(0)
  const suspiciousLoggedRef = useRef<Record<SuspiciousReason, boolean>>({
    repeated_failure: false,
    low_variance: false,
    timeout: false,
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
  const [modelLoadLabel, setModelLoadLabel] = useState("Detector facial")
  const [challenge, setChallenge] = useState<LivenessChallenge>(() => pickChallenge())
  const [challengeStartedAt, setChallengeStartedAt] = useState(() => Date.now())
  const [challengeProgress, setChallengeProgress] = useState(100)
  const [isChallengeComplete, setIsChallengeComplete] = useState(false)
  const [isCollectingLiveness, setIsCollectingLiveness] = useState(false)
  
  const STABILITY_REQUIRED = 8 // ~2.4s at 300ms
  const COUNTDOWN_SECONDS = 4
  const requiresServerVerification = Boolean(verifyEmployeeId)
  const shouldRequireLiveness = requireLiveness ?? requiresServerVerification

  const getDetectorOptions = useCallback((scoreThresholdOverride?: number) => {
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768
    return new faceapi.TinyFaceDetectorOptions({
      inputSize: isMobile ? 224 : 320,
      scoreThreshold: scoreThresholdOverride ?? (isMobile ? 0.45 : 0.5),
    })
  }, [])

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
      if (shouldRequireLiveness) {
        const next = pickChallenge(challenge)
        setChallenge(next)
        setChallengeStartedAt(Date.now())
        setChallengeProgress(100)
        setIsChallengeComplete(false)
        challengeBaselineRef.current = null
        setStatusText(LIVENESS_CHALLENGES[next].label)
      } else {
        setStatusText("Posicione seu rosto no centro")
      }
    } catch (err: unknown) {
      console.error("Erro ao acessar câmera:", err)
      const msg = err instanceof DOMException && err.name === "NotAllowedError"
        ? "Permissão da câmera foi negada. Acesse as configurações do navegador e permita o uso da câmera para este site."
        : err instanceof DOMException && err.name === "NotFoundError"
        ? "Nenhuma câmera foi encontrada neste dispositivo. Conecte uma webcam ou libere a câmera do celular."
        : "Erro ao acessar a câmera. Verifique se outro aplicativo está usando a câmera e tente novamente."
      setError(msg)
    }
  }, [challenge, shouldRequireLiveness])

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

  // Liveness básico: detecta movimento e variância natural.
  // Não substitui SDK especializado (iProov, FaceTec).
  // Adequado para controle interno NR-06, não para autenticação bancária ou acesso físico crítico.
  const resetChallenge = useCallback((previous?: LivenessChallenge) => {
    const next = pickChallenge(previous)
    setChallenge(next)
    setChallengeStartedAt(Date.now())
    setChallengeProgress(100)
    setIsChallengeComplete(false)
    challengeBaselineRef.current = null
    stabilityRef.current = 0
    setStability(0)
    setStatusText(LIVENESS_CHALLENGES[next].label)
  }, [])

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

  const detectChallenge = useCallback((detections: {
    landmarks: { positions: Array<{ x: number; y: number }> }
    detection: { box: { width: number } }
  }) => {
    const points = detections.landmarks.positions
    const nose = points[30]
    const leftEyeCorner = points[36]
    const rightEyeCorner = points[45]
    const faceWidth = Math.max(detections.detection.box.width, 1)
    const elapsed = Date.now() - challengeStartedAt
    const remaining = Math.max(0, 1 - elapsed / LIVENESS_TIMEOUT_MS)
    setChallengeProgress(Math.round(remaining * 100))

    if (elapsed >= LIVENESS_TIMEOUT_MS) {
      challengeTimeoutCountRef.current += 1
      if (challengeTimeoutCountRef.current >= 3) {
        void logSuspiciousAttempt("timeout", challengeTimeoutCountRef.current)
      }
      resetChallenge(challenge)
      setWarning("Tempo esgotado. Novo desafio gerado.")
      return
    }

    if (!nose || !leftEyeCorner || !rightEyeCorner) return

    const eyeCenterX = (leftEyeCorner.x + rightEyeCorner.x) / 2
    const yawOffset = (nose.x - eyeCenterX) / faceWidth

    const eyebrowPoints = points.slice(17, 27)
    const eyePoints = points.slice(36, 48)
    const avgY = (items: Array<{ y: number }>) =>
      items.reduce((sum, item) => sum + item.y, 0) / Math.max(items.length, 1)
    const eyebrowEyeDistance = Math.max(avgY(eyePoints) - avgY(eyebrowPoints), 0)
    if (!challengeBaselineRef.current) {
      challengeBaselineRef.current = { eyebrowEyeDistance }
    }

    const pitchBaseline = Math.max(challengeBaselineRef.current.eyebrowEyeDistance || eyebrowEyeDistance, 1)
    const pitchRatio = eyebrowEyeDistance / pitchBaseline
    const passed =
      (challenge === "turn_right" && yawOffset > 0.15) ||
      (challenge === "turn_left" && yawOffset < -0.15) ||
      (challenge === "look_up" && pitchRatio > 1.1)

    if (!passed) {
      setStatusText(LIVENESS_CHALLENGES[challenge].label)
      return
    }

    challengeTimeoutCountRef.current = 0
    setIsChallengeComplete(true)
    setWarning(null)
    setStatusText("Movimento confirmado. Estabilizando...")
    setTimeout(() => {
      setStatusText("Mantenha o rosto parado para verificação")
    }, 500)
  }, [challenge, challengeStartedAt, logSuspiciousAttempt, resetChallenge])

  const averageDescriptors = useCallback((samples: Float32Array[]) => {
    const length = samples[0]?.length || 0
    const average = new Float32Array(length)
    samples.forEach(sample => {
      for (let index = 0; index < length; index += 1) average[index] += sample[index]
    })
    for (let index = 0; index < length; index += 1) average[index] /= samples.length
    return average
  }, [])

  const descriptorVariance = useCallback((samples: Float32Array[], average: Float32Array) => {
    if (samples.length < 2 || average.length === 0) return 0
    let sum = 0
    let count = 0
    samples.forEach(sample => {
      for (let index = 0; index < average.length; index += 1) {
        const delta = sample[index] - average[index]
        sum += delta * delta
        count += 1
      }
    })
    return sum / Math.max(count, 1)
  }, [])

  const collectLivenessDescriptor = useCallback(async () => {
    if (!videoRef.current) return null
    setIsCollectingLiveness(true)
    setStatusText("Verificando movimento natural...")

    const samples: Float32Array[] = []
    for (let index = 0; index < 3; index += 1) {
      const detection = await faceapi.detectSingleFace(
        videoRef.current,
        getDetectorOptions(0.4)
      ).withFaceLandmarks().withFaceDescriptor()

      if (!detection) {
        setIsCollectingLiveness(false)
        setStatusText("Rosto não detectado no momento da verificação. Tente novamente.")
        return null
      }

      samples.push(detection.descriptor)
      if (index < 2) await delay(400)
    }

    const average = averageDescriptors(samples)
    const variance = descriptorVariance(samples, average)
    setIsCollectingLiveness(false)

    if (variance < LOW_VARIANCE_THRESHOLD) {
      mismatchRef.current += 1
      setIsVerified(false)
      setWarning("Movimento natural não detectado. Tente novamente.")
      setStatusText("Movimento natural não detectado. Tente novamente.")
      void logSuspiciousAttempt("low_variance", mismatchRef.current || 1)
      resetChallenge(challenge)
      return null
    }

    return average
  }, [averageDescriptors, challenge, descriptorVariance, getDetectorOptions, logSuspiciousAttempt, resetChallenge])

  const verifyDescriptor = useCallback(async (descriptor: Float32Array) => {
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
        descriptor: Array.from(descriptor),
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

  // -- Load AI Models --
  useEffect(() => {
    const loadModels = async () => {
      try {
        let loadedWeight = 0
        for (const step of MODEL_STEPS) {
          setModelLoadLabel(step.label)
          setStatusText(`Carregando reconhecimento facial... ${Math.round(loadedWeight * 100)}%`)
          await step.load()
          loadedWeight += step.weight
          const progress = Math.min(100, Math.round(loadedWeight * 100))
          setModelLoadProgress(progress)
          setStatusText(`Carregando reconhecimento facial... ${progress}%`)
        }
        setIsModelsLoaded(true)
        setModelLoadProgress(100)
        setStatusText("Modelos carregados.")
      } catch (err) {
        console.error("Erro ao carregar modelos:", err)
        setError("Falha ao carregar inteligência artificial. Verifique os modelos em /public/models.")
      }
    }
    loadModels()
    return () => { stopCamera() }
  }, [stopCamera])

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

      // If countdown is active, STOP detecting - just let the countdown run
      if (countdownActiveRef.current) return

      const detections = await faceapi.detectSingleFace(
        videoRef.current, 
        getDetectorOptions()
      ).withFaceLandmarks().withFaceDescriptor()

      const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true })

      if (detections) {
        setWarning(null)
        stabilityRef.current += 1
        setStability(stabilityRef.current)
        
        // Check face quality - low score can mean obstructions (hat, glasses, etc)
        const score = detections.detection.score
        if (score < 0.7) {
          setWarning("Detecção fraca: remova óculos escuros, bonés ou chapéus.")
        }

        // Check face size - too small means too far
        const box = detections.detection.box
        const videoW = videoRef.current.videoWidth
        const faceRatio = box.width / videoW
        if (faceRatio < 0.15) {
          setWarning("Aproxime-se mais da câmera.")
        }

        if (shouldRequireLiveness && !isChallengeComplete) {
          detectChallenge(detections)
          stabilityRef.current = 0
          setStability(0)
          return
        }

        // Draw detection overlay
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
          const rBox = detections.detection.box
          const boxX = offsetX + rBox.x * scale
          const boxY = offsetY + rBox.y * scale
          const boxW = rBox.width * scale
          const boxH = rBox.height * scale
          const mirroredX = canvas.width - boxX - boxW
          const cx = mirroredX + boxW / 2
          const cy = boxY + boxH / 2
          const radius = Math.max(boxW, boxH) * 0.62
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
          if (requiresServerVerification) {
            if (shouldRequireLiveness) {
              countdownActiveRef.current = true
              setStatusText("Desafio concluído! Prepare-se...")
              setCountdown(COUNTDOWN_SECONDS)
              return
            }
            if (verificationPendingRef.current) return
            verificationPendingRef.current = true
            setStatusText("Validando identidade...")
            try {
              const result = await verifyDescriptor(detections.descriptor)
              if (result.match) {
                setIsVerified(true)
                matchedDescriptorRef.current = detections.descriptor
                countdownActiveRef.current = true
                setStatusText("Identidade confirmada! Prepare-se...")
                setCountdown(COUNTDOWN_SECONDS)
              } else {
                mismatchRef.current += 1
                setWarning("Rosto não reconhecido. Use o mesmo colaborador cadastrado.")
                setStatusText("Identidade não confirmada.")
                if (mismatchRef.current >= 3) {
                  setError("Rosto não reconhecido. A verificação facial não corresponde à biometria cadastrada para este colaborador.")
                  void logSuspiciousAttempt("repeated_failure", mismatchRef.current)
                }
                stabilityRef.current = Math.max(stabilityRef.current - 4, 0)
                setStability(stabilityRef.current)
              }
            } catch (err) {
              mismatchRef.current += 1
              setWarning(err instanceof Error ? err.message : "Falha ao validar biometria.")
              setStatusText("Identidade não confirmada.")
              if (mismatchRef.current >= 3) {
                setError("Rosto não reconhecido. A verificação facial não corresponde à biometria cadastrada para este colaborador.")
                void logSuspiciousAttempt("repeated_failure", mismatchRef.current)
              }
              stabilityRef.current = Math.max(stabilityRef.current - 4, 0)
              setStability(stabilityRef.current)
            } finally {
              verificationPendingRef.current = false
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
        // No face - only reset if countdown is NOT active
        if (!countdownActiveRef.current) {
          stabilityRef.current = 0
          setStability(0)
          setIsVerified(false)
          if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
          if (shouldRequireLiveness && !isChallengeComplete) {
            const elapsed = Date.now() - challengeStartedAt
            const remaining = Math.max(0, 1 - elapsed / LIVENESS_TIMEOUT_MS)
            setChallengeProgress(Math.round(remaining * 100))
            if (elapsed >= LIVENESS_TIMEOUT_MS) {
              challengeTimeoutCountRef.current += 1
              if (challengeTimeoutCountRef.current >= 3) {
                void logSuspiciousAttempt("timeout", challengeTimeoutCountRef.current)
              }
              resetChallenge(challenge)
              setWarning("Tempo esgotado. Novo desafio gerado.")
              return
            }
          }
          setStatusText(shouldRequireLiveness ? LIVENESS_CHALLENGES[challenge].label : requiresServerVerification ? "Posicione seu rosto para verificação" : "Posicione seu rosto no centro")
        }
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

  // -- Countdown timer --
  useEffect(() => {
    if (countdown !== null && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    } else if (countdown === 0) {
      const doCapture = async () => {
        if (!videoRef.current) return
        const d = await faceapi.detectSingleFace(
          videoRef.current,
          getDetectorOptions(0.4)
        ).withFaceLandmarks().withFaceDescriptor()

        if (d) {
          if (requiresServerVerification) {
            try {
              const descriptorForVerification = shouldRequireLiveness
                ? await collectLivenessDescriptor()
                : d.descriptor

              if (!descriptorForVerification) {
                countdownActiveRef.current = false
                setCountdown(null)
                setIsVerified(false)
                stabilityRef.current = 0
                setStability(0)
                return
              }

              const result = await verifyDescriptor(descriptorForVerification)
              if (result.match) {
                captureSuccess(descriptorForVerification)
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
            }
          } else {
              captureSuccess(d.descriptor)
          }
        } else {
          // Face lost at capture moment - retry
          countdownActiveRef.current = false
          setCountdown(null)
          stabilityRef.current = 0
          setStability(0)
          setStatusText("Rosto não detectado no momento da captura. Tente novamente.")
        }
      }
      doCapture()
    }
  }, [collectLivenessDescriptor, countdown, captureSuccess, getDetectorOptions, logSuspiciousAttempt, requiresServerVerification, shouldRequireLiveness, verifyDescriptor])

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
              <strong className="text-amber-900">Atenção:</strong> O sistema pode recusar a captura se detectar bonés, óculos escuros ou iluminação ruim. Remova todos os acessórios antes de iniciar.
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
              <div className={`w-full max-w-sm rounded-2xl border p-3 sm:p-4 shadow-2xl backdrop-blur-md transition-all ${
                isChallengeComplete
                  ? "border-emerald-400/50 bg-emerald-950/85"
                  : "border-white/15 bg-black/75"
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                    isChallengeComplete ? "bg-emerald-500 text-white" : "bg-white/10 text-white"
                  }`}>
                    {isChallengeComplete ? (
                      <CheckCircle2 className="h-7 w-7 animate-in zoom-in" />
                    ) : (
                      (() => {
                        const ChallengeIcon = LIVENESS_CHALLENGES[challenge].Icon
                        return <ChallengeIcon className="h-7 w-7" />
                      })()
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className={`text-lg font-medium leading-tight ${
                      isChallengeComplete ? "text-emerald-100" : "text-white"
                    }`}>
                      {isCollectingLiveness
                        ? "Coletando prova de vida..."
                        : isChallengeComplete
                          ? "Movimento confirmado"
                          : LIVENESS_CHALLENGES[challenge].label}
                    </p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-white/55">
                      Verificação ao vivo — fotos não são aceitas
                    </p>
                  </div>
                </div>
                {!isChallengeComplete && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full bg-blue-400 transition-all duration-300"
                      style={{ width: `${challengeProgress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Circular guide - fixed size to prevent distortion on mobile */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-48 h-48 sm:w-56 sm:h-56 rounded-full border-2 border-dashed border-white/20" />
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
                <span className="text-[7px] sm:text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none">SafeEPI Digital</span>
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
          {!shouldRequireLiveness && !countdown && isCameraActive && !warning && (
            <div className="absolute top-2 left-2 right-2 sm:top-4 sm:left-4 sm:right-4 flex justify-center pointer-events-none">
              <div className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-full text-[8px] sm:text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 sm:gap-2 shadow-lg ${
                isVerified ? 'bg-green-600/90 text-white' : 'bg-blue-600/90 text-white'
              }`}>
                <Info className="w-3 h-3" />
                {requiresServerVerification 
                  ? (isVerified ? "Identidade OK - Posicione-se" : "Verificando identidade...")
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
