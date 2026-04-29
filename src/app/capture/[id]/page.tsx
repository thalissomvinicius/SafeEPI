"use client"

import { useState, useEffect } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Camera, CheckCircle2, Loader2, AlertTriangle, ShieldCheck, Lock, RefreshCw, XCircle } from "lucide-react"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { formatCpf } from "@/utils/cpf"
import Image from "next/image"
import { Suspense } from "react"
import { toast } from "sonner"

interface LinkData {
  id: string
  employee_id: string
  token: string
  status: string
  type: string
  employee: {
    id: string
    full_name: string
    cpf: string
    photo_url: string | null
  }
}

function CaptureContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const employeeId = params.id as string
  const token = searchParams.get('t')

  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [linkStatus, setLinkStatus] = useState<string>("")
  const [employee, setEmployee] = useState<LinkData['employee'] | null>(null)
  const [linkToken, setLinkToken] = useState<string>("")
  
  // Verificação de CPF
  const [cpfInput, setCpfInput] = useState("")
  const [cpfVerified, setCpfVerified] = useState(false)
  const [cpfError, setCpfError] = useState("")

  // Captura
  const [isCapturing, setIsCapturing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  
  // Preview da foto capturada
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null)
  const [capturedDescriptor, setCapturedDescriptor] = useState<Float32Array | null>(null)

  // â”€â”€ Auto-scroll to top on state change â”€â”€
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [cpfVerified, isCapturing, isSuccess, capturedPhoto])

  useEffect(() => {
    async function validateLink() {
      try {
        if (token) {
          // Novo fluxo: validar via token
          const res = await fetch(`/api/remote-links?token=${token}`)
          const data = await res.json()
          
          if (!res.ok) {
            setPageError(data.error || "Link inválido.")
            setLinkStatus(data.status || "invalid")
            return
          }

          setEmployee(data.link.employee)
          setLinkToken(data.link.token)
        } else {
          // Fallback: fluxo antigo sem token (compatibilidade)
          const res = await fetch(`/api/remote-capture?id=${employeeId}`)
          if (!res.ok) throw new Error("Colaborador não encontrado.")
          const data = await res.json()
          setEmployee(data)
        }
      } catch (err: unknown) {
        setPageError(err instanceof Error ? err.message : "Erro desconhecido.")
      } finally {
        setLoading(false)
      }
    }
    
    if (employeeId) validateLink()
  }, [employeeId, token])

  const handleCpfVerify = () => {
    if (!employee) return
    setCpfError("")
    const inputDigits = cpfInput.replace(/\D/g, '')
    const employeeDigits = employee.cpf.replace(/\D/g, '')
    
    if (inputDigits.length < 11) {
      setCpfError("Digite o CPF completo (11 dígitos).")
      return
    }

    if (inputDigits === employeeDigits) {
      setCpfVerified(true)
    } else {
      setCpfError("CPF não confere com o cadastro. Verifique e tente novamente.")
    }
  }

  // Captura da foto - mostra preview
  const handleCapture = (face_descriptor: Float32Array, photo_url: string) => {
    setIsCapturing(false)
    setCapturedPhoto(photo_url)
    setCapturedDescriptor(face_descriptor)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Refazer - volta para a câmera
  const handleRetake = () => {
    setCapturedPhoto(null)
    setCapturedDescriptor(null)
    setIsCapturing(true)
  }

  // Confirmar - envia para o banco e desativa o link
  const handleConfirm = async () => {
    if (!capturedPhoto || !capturedDescriptor) return
    setIsSaving(true)
    
    try {
      const res = await fetch('/api/remote-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: employee!.id,
          photo_url: capturedPhoto,
          face_descriptor: Array.from(capturedDescriptor),
          token: linkToken // Passa o token para validação e conclusão no servidor
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Erro ao salvar a biometria.")
      }

      setIsSuccess(true)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? "Falha: " + err.message : "Falha ao salvar biometria.")
    } finally {
      setIsSaving(false)
    }
  }

  // â”€â”€ LOADING â”€â”€
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#2563EB]" />
      </div>
    )
  }

  // â”€â”€ ERRO / LINK EXPIRADO / LINK JÁ USADO â”€â”€
  if (pageError || !employee) {
    const isExpired = linkStatus === 'expired'
    const isCompleted = linkStatus === 'completed'
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl text-center max-w-md w-full space-y-4">
          {isCompleted ? (
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
          ) : isExpired ? (
            <XCircle className="w-16 h-16 text-orange-500 mx-auto" />
          ) : (
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto" />
          )}
          <h1 className="text-xl font-black text-slate-800 uppercase tracking-tighter">
            {isCompleted ? "Captura Já Concluída" : isExpired ? "Link Expirado" : "Erro no Link"}
          </h1>
          <p className="text-slate-500 font-medium">{pageError}</p>
          {isCompleted && (
            <p className="text-sm text-green-600 font-bold">A biometria já foi registrada com sucesso. Pode fechar esta tela.</p>
          )}
        </div>
      </div>
    )
  }

  // â”€â”€ SUCESSO â”€â”€
  if (isSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4 animate-in fade-in zoom-in duration-500">
        <CheckCircle2 className="w-24 h-24 text-green-500 mb-6" />
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter mb-2 text-center">Biometria Salva!</h1>
        <p className="text-slate-500 text-center max-w-sm mb-8">
          Sua foto foi registrada com sucesso no sistema. Você já pode fechar esta tela.
        </p>
      </div>
    )
  }

  // â”€â”€ CÃ‚MERA FULLSCREEN â”€â”€
  if (isCapturing) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col z-50">
        <div className="flex items-center justify-between p-3 bg-black/80 z-10">
          <h3 className="text-white font-black uppercase text-xs tracking-widest">Captura Facial</h3>
          <button onClick={() => setIsCapturing(false)} className="text-white text-xs font-bold bg-white/20 px-3 py-1.5 rounded-full">Cancelar</button>
        </div>
        <div className="flex-1 min-h-0">
           <FaceCamera 
              onCapture={handleCapture}
              onCancel={() => setIsCapturing(false)}
              cancelLabel="Cancelar"
           />
        </div>
      </div>
    )
  }

  // â”€â”€ PREVIEW DA FOTO CAPTURADA â”€â”€
  if (capturedPhoto) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 flex flex-col items-center justify-center">
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-5 animate-in fade-in">
          <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter">Confirme sua Foto</h2>
          
          <div className="relative mx-auto w-48 h-48 sm:w-56 sm:h-56 rounded-full overflow-hidden border-4 border-green-500 shadow-xl">
            <Image 
              src={capturedPhoto} 
              alt="Foto capturada" 
              fill 
              className="object-cover"
              unoptimized 
            />
          </div>

          <p className="text-sm text-slate-500">
            Esta foto ficará registrada no seu cadastro. Verifique se está nítida e bem centralizada.
          </p>

          <div className="flex flex-col gap-3">
            <button 
              onClick={handleConfirm}
              disabled={isSaving}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-2xl font-black uppercase tracking-widest transition-all shadow-lg shadow-green-900/20 border-b-4 border-green-800 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Salvando...</>
              ) : (
                <><CheckCircle2 className="w-5 h-5" /> Confirmar e Enviar</>
              )}
            </button>
            <button 
              onClick={handleRetake}
              disabled={isSaving}
              className="w-full bg-white border-2 border-slate-200 text-slate-600 py-3 rounded-2xl font-black uppercase tracking-widest text-xs transition-all hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" /> Tirar Outra Foto
            </button>
          </div>
        </div>
      </div>
    )
  }

  // â”€â”€ VERIFICAÇÃƒO DE CPF â”€â”€
  if (!cpfVerified) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 flex flex-col items-center justify-center">
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-5">
          <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
            <Lock className="w-7 h-7 text-[#2563EB]" />
          </div>
          
          <div>
            <h1 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Verificação de Identidade</h1>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">SafeEPI</p>
          </div>

          <p className="text-sm text-slate-500">
            Para sua segurança, informe o seu CPF para confirmar sua identidade.
          </p>

          <div className="space-y-3">
            <input 
              type="text"
              value={cpfInput}
              onChange={(e) => { setCpfInput(formatCpf(e.target.value)); setCpfError(""); }}
              placeholder="000.000.000-00"
              maxLength={14}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-center text-lg font-bold focus:border-[#2563EB] focus:outline-none transition-all tracking-widest"
              autoFocus
              inputMode="numeric"
              onKeyDown={(e) => e.key === 'Enter' && handleCpfVerify()}
            />
            
            {cpfError && (
              <p className="text-red-500 text-xs font-bold animate-in fade-in">{cpfError}</p>
            )}

            <button 
              onClick={handleCpfVerify}
              className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white py-3.5 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-blue-900/20 border-b-4 border-red-900 flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" /> Verificar CPF
            </button>
          </div>
        </div>
      </div>
    )
  }

  // â”€â”€ TELA PRINCIPAL (CPF verificado) â”€â”€
  return (
    <div className="min-h-screen bg-slate-50 p-4 flex flex-col items-center justify-center">
      <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-5">
        <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
          <Camera className="w-7 h-7 text-green-600" />
        </div>
        
        <div>
          <h1 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Cadastro de Biometria</h1>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">SafeEPI</p>
        </div>

        <div className="bg-green-50 p-3 rounded-xl border border-green-200 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div className="text-left">
            <p className="text-[10px] text-green-700 font-bold uppercase tracking-widest">Identidade Confirmada</p>
            <p className="font-black text-green-900 text-sm">{employee.full_name}</p>
          </div>
        </div>

        <button 
          onClick={() => setIsCapturing(true)}
          className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white py-4 rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl shadow-blue-900/20 border-b-4 border-red-900 flex items-center justify-center gap-2"
        >
          <Camera className="w-5 h-5" /> Iniciar Câmera
        </button>

        <p className="text-[9px] text-slate-400 italic">
          Certifique-se de estar em um local bem iluminado e retire óculos escuros ou bonés.
        </p>
      </div>
    </div>
  )
}

export default function RemoteCapturePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#2563EB]" />
      </div>
    }>
      <CaptureContent />
    </Suspense>
  )
}
