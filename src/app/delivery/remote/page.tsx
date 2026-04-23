"use client"

import { useState, useRef, useEffect, Suspense, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import SignatureCanvas from "react-signature-canvas"
import { CheckCircle2, FileDown, Loader2, ShieldAlert, Fingerprint, PenLine, ShieldCheck, UserCheck, Lock } from "lucide-react"
import { api } from "@/services/api"
import { Employee, PPE, Workplace } from "@/types/database"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { generateDeliveryPDF } from "@/utils/pdfGenerator"
import { COMPANY_CONFIG } from "@/config/company"

interface DeliveryData {
  e: string // employee id
  p: string // ppe id
  w: string // workplace id
  q: number // quantity
  r: string // reason
}

function RemoteDeliveryContent() {
  const searchParams = useSearchParams()
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  
  // ── Page states ──
  const [phase, setPhase] = useState<'loading' | 'error' | 'verify' | 'sign' | 'done'>('loading')
  const [errorMsg, setErrorMsg] = useState("")

  // ── Verification form ──
  const [inputName, setInputName] = useState("")
  const [inputCpf, setInputCpf] = useState("")
  const [verifyError, setVerifyError] = useState("")
  const [verifyAttempts, setVerifyAttempts] = useState(0)

  // ── Delivery data ──
  const [deliveryData, setDeliveryData] = useState<DeliveryData | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [ppe, setPpe] = useState<PPE | null>(null)
  const [workplace, setWorkplace] = useState<Workplace | null>(null)

  // ── Signing ──
  const [authMethod, setAuthMethod] = useState<'manual' | 'facial'>('manual')
  const [isSaving, setIsSaving] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)

  // ── Metadata ──
  const [ipAddress, setIpAddress] = useState("")
  const [location, setLocation] = useState("")

  // ── Load delivery data on mount ──
  useEffect(() => {
    const s = searchParams.get('s')
    if (!s) {
      setErrorMsg("Link inválido ou expirado.")
      setPhase('error')
      return
    }

    // Capture IP & location
    const captureMetadata = async () => {
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json')
        const ipData = await ipRes.json()
        setIpAddress(ipData.ip)
        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition((pos) => {
            setLocation(`${pos.coords.latitude}, ${pos.coords.longitude}`)
          })
        }
      } catch { /* ignore */ }
    }
    captureMetadata()

    try {
      const decoded: DeliveryData = JSON.parse(atob(s))
      setDeliveryData(decoded)
      
      async function loadDetails() {
        try {
          const [employees, ppes, workplaces] = await Promise.all([
            api.getEmployees(),
            api.getPpes(),
            api.getWorkplaces()
          ])
          const emp = employees.find(e => e.id === decoded.e)
          const p = ppes.find(p => p.id === decoded.p)
          const w = workplaces.find(w => w.id === decoded.w)

          if (!emp || !p) {
            setErrorMsg("Dados da entrega não encontrados no sistema.")
            setPhase('error')
          } else {
            setEmployee(emp)
            setPpe(p)
            setWorkplace(w || null)
            setPhase('verify') // Go to identity verification
          }
        } catch {
          setErrorMsg("Falha ao conectar com o servidor.")
          setPhase('error')
        }
      }
      loadDetails()
    } catch {
      setErrorMsg("Erro ao processar o link de assinatura.")
      setPhase('error')
    }
  }, [searchParams])

  // ── CPF formatter (xxx.xxx.xxx-xx) ──
  const formatCpf = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
  }

  const handleCpfChange = (value: string) => {
    setInputCpf(formatCpf(value))
    setVerifyError("")
  }

  // ── Identity verification ──
  const handleVerify = () => {
    if (!employee) return
    
    if (!inputName.trim() || !inputCpf.trim()) {
      setVerifyError("Preencha todos os campos.")
      return
    }

    // Normalize CPFs for comparison (remove dots and dashes)
    const normalizedInput = inputCpf.replace(/\D/g, '')
    const normalizedDb = employee.cpf.replace(/\D/g, '')

    if (normalizedInput !== normalizedDb) {
      const attempts = verifyAttempts + 1
      setVerifyAttempts(attempts)
      if (attempts >= 3) {
        setErrorMsg("Número máximo de tentativas excedido. Solicite um novo link ao gestor.")
        setPhase('error')
      } else {
        setVerifyError(`CPF não confere com o colaborador vinculado. Tentativa ${attempts}/3.`)
      }
      return
    }

    // CPF matches — proceed to signing
    setPhase('sign')
  }

  // ── Save delivery ──
  const saveDelivery = useCallback(async (signatureDataUrl: string) => {
    if (!employee || !ppe) return
    try {
      setIsSaving(true)
      const payload = `${employee.id}-${ppe.id}-${Date.now()}`
      const validationHash = btoa(payload).substring(0, 12).toUpperCase()
      
      const response = await fetch(signatureDataUrl)
      const blob = await response.blob()
      const signatureFile = new File([blob], "remote_signature.png", { type: "image/png" })

      await api.saveDelivery({
        employee_id: employee.id,
        ppe_id: ppe.id,
        workplace_id: workplace?.id || null,
        reason: (deliveryData?.r || 'Primeira Entrega') as 'Primeira Entrega' | 'Substituição (Desgaste/Validade)' | 'Perda' | 'Dano',
        quantity: deliveryData?.q || 1,
        ip_address: ipAddress || "Remoto",
        signature_url: null
      }, signatureFile)

      const pdfBlob = await generateDeliveryPDF({
        employeeName: employee.full_name,
        employeeCpf: employee.cpf,
        employeeRole: employee.job_title,
        workplaceName: workplace?.name || "Sede",
        ppeName: ppe.name,
        ppeCaNumber: ppe.ca_number,
        quantity: deliveryData?.q || 1,
        reason: deliveryData?.r || "Entrega Remota",
        authMethod,
        signatureBase64: signatureDataUrl,
        ipAddress,
        location,
        validationHash
      })
      setLastPdfUrl(URL.createObjectURL(pdfBlob))
      setPhase('done')
    } catch (err) {
      console.error(err)
      alert("Erro ao salvar assinatura. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }, [employee, ppe, workplace, deliveryData, authMethod, ipAddress, location])

  // ───────────────────────────────────────
  // RENDER: Loading
  // ───────────────────────────────────────
  if (phase === 'loading') return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
      <Loader2 className="w-10 h-10 animate-spin text-[#8B1A1A] mb-4" />
      <p className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">Validando Link de Assinatura...</p>
    </div>
  )

  // ───────────────────────────────────────
  // RENDER: Error
  // ───────────────────────────────────────
  if (phase === 'error') return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
      <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">{errorMsg}</h2>
      <p className="text-slate-500 mt-2 text-sm">Solicite um novo link ao gestor do SESMT.</p>
    </div>
  )

  // ───────────────────────────────────────
  // RENDER: Done
  // ───────────────────────────────────────
  if (phase === 'done') return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center animate-in zoom-in">
      <div className="bg-green-100 p-4 rounded-full mb-6 text-green-600">
        <ShieldCheck className="w-16 h-16" />
      </div>
      <h2 className="text-2xl font-black text-slate-800 mb-2 uppercase tracking-tighter">Assinatura Confirmada</h2>
      <p className="text-slate-500 max-w-md italic text-sm">O comprovante foi registrado e está disponível para download.</p>
      <div className="mt-8 flex flex-col gap-4 w-full max-w-xs">
        {lastPdfUrl && (
          <a href={lastPdfUrl} target="_blank" download="comprovante_antares.pdf" className="px-8 py-4 bg-[#8B1A1A] text-white rounded-xl font-bold shadow-lg flex items-center justify-center gap-2">
            <FileDown className="w-5 h-5" /> Baixar Comprovante
          </a>
        )}
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pode fechar esta janela.</p>
      </div>
    </div>
  )

  // ───────────────────────────────────────
  // RENDER: Identity Verification (CPF)
  // ───────────────────────────────────────
  if (phase === 'verify') return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-block bg-[#8B1A1A] text-white text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] mb-2">Verificação de Identidade</div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 uppercase tracking-tighter">Confirme seus Dados</h1>
          <p className="text-slate-500 text-xs sm:text-sm">Para sua segurança, informe seus dados pessoais antes de assinar.</p>
        </div>

        <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-xl shadow-slate-200/50 border border-slate-200 space-y-5">
          {/* EPI Info (read-only preview) */}
          <div className="bg-slate-50 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-slate-100">
            <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Item pendente de assinatura:</p>
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-800 text-sm sm:text-base">{ppe?.name}</span>
              <span className="bg-slate-200 text-slate-600 text-[9px] sm:text-[10px] font-black px-2 py-0.5 rounded">Qtd: {deliveryData?.q}</span>
            </div>
            <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">C.A.: {ppe?.ca_number}</p>
          </div>

          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
            <Lock className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <p className="text-[10px] sm:text-[11px] text-blue-700 leading-tight">
              Informe seu <strong>Nome Completo</strong> e <strong>CPF</strong> para liberar a assinatura.
            </p>
          </div>

          {/* Name input */}
          <div className="space-y-1.5">
            <label htmlFor="remote-name" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome Completo</label>
            <input 
              id="remote-name"
              type="text"
              placeholder="Digite seu nome completo"
              value={inputName}
              onChange={(e) => { setInputName(e.target.value); setVerifyError("") }}
              className="w-full bg-slate-50 border-2 border-slate-100 text-slate-900 rounded-xl p-3 sm:p-4 outline-none focus:border-[#8B1A1A] transition-all font-bold text-sm"
              autoComplete="name"
            />
          </div>

          {/* CPF input */}
          <div className="space-y-1.5">
            <label htmlFor="remote-cpf" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">CPF</label>
            <input 
              id="remote-cpf"
              type="text"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={inputCpf}
              onChange={(e) => handleCpfChange(e.target.value)}
              className="w-full bg-slate-50 border-2 border-slate-100 text-slate-900 rounded-xl p-3 sm:p-4 outline-none focus:border-[#8B1A1A] transition-all font-bold text-sm tracking-wider"
              maxLength={14}
              autoComplete="off"
            />
          </div>

          {/* Error message */}
          {verifyError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 animate-in fade-in">
              <ShieldAlert className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-[11px] sm:text-xs font-bold">{verifyError}</p>
            </div>
          )}

          {/* Submit */}
          <button 
            onClick={handleVerify}
            disabled={!inputName.trim() || inputCpf.replace(/\D/g, '').length < 11}
            className="w-full bg-[#8B1A1A] hover:bg-[#681313] active:bg-[#501010] disabled:bg-slate-300 text-white py-4 sm:py-5 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[11px] sm:text-xs transition-all shadow-lg flex items-center justify-center gap-2"
          >
            <UserCheck className="w-4 h-4" />
            Verificar Identidade
          </button>
        </div>

        <p className="text-center text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">
          Segurança Certificada — {COMPANY_CONFIG.systemName}
        </p>
      </div>
    </div>
  )

  // ───────────────────────────────────────
  // RENDER: Signing Area (after CPF verified)
  // ───────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 pt-8 sm:pt-12">
      <div className="w-full max-w-lg space-y-4 sm:space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-block bg-green-600 text-white text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] mb-2">✓ Identidade Verificada</div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 uppercase tracking-tighter">Confirmação de Recebimento</h1>
          <p className="text-slate-500 text-xs sm:text-sm font-medium">{employee?.full_name} — {COMPANY_CONFIG.name}</p>
        </div>

        <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl shadow-slate-200/50 border border-slate-200 space-y-4 sm:space-y-6">
          {/* EPI Summary */}
          <div className="bg-slate-50 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-slate-100">
            <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Item a ser assinado:</p>
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-800 text-sm">{ppe?.name}</span>
              <span className="bg-slate-200 text-slate-600 text-[9px] sm:text-[10px] font-black px-2 py-0.5 rounded">Qtd: {deliveryData?.q}</span>
            </div>
            <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">C.A.: {ppe?.ca_number}</p>
          </div>

          {/* Auth method toggle */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button onClick={() => setAuthMethod('manual')} className={`flex-1 py-2.5 sm:py-3 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${authMethod === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>
              <PenLine className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Manual
            </button>
            <button onClick={() => setAuthMethod('facial')} className={`flex-1 py-2.5 sm:py-3 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${authMethod === 'facial' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
              <Fingerprint className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Biometria
            </button>
          </div>

          {/* Manual signature */}
          {authMethod === 'manual' ? (
            <div className="space-y-3 sm:space-y-4 animate-in fade-in">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Assine no espaço abaixo:</label>
                <button onClick={() => sigCanvas.current?.clear()} className="text-[10px] font-black text-[#8B1A1A] uppercase italic">Limpar</button>
              </div>
              <div className="bg-white rounded-xl sm:rounded-2xl border-2 border-slate-100 h-48 sm:h-64 overflow-hidden touch-none">
                <SignatureCanvas ref={sigCanvas} canvasProps={{ className: 'w-full h-full' }} />
              </div>
              <button onClick={() => {
                if (sigCanvas.current?.isEmpty()) return alert("Assine antes de confirmar.")
                saveDelivery(sigCanvas.current!.getTrimmedCanvas().toDataURL())
              }} disabled={isSaving} className="w-full bg-[#8B1A1A] hover:bg-[#681313] active:bg-[#501010] text-white py-4 sm:py-5 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[11px] sm:text-xs shadow-lg disabled:opacity-50 flex items-center justify-center">
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirmar Recebimento"}
              </button>
            </div>
          ) : (
            <div className="space-y-4 animate-in zoom-in-95">
              {!employee?.face_descriptor ? (
                <div className="bg-amber-50 border border-amber-200 p-4 sm:p-6 rounded-xl sm:rounded-2xl text-center space-y-2 sm:space-y-3">
                  <ShieldAlert className="w-7 h-7 sm:w-8 sm:h-8 text-amber-500 mx-auto" />
                  <p className="text-amber-800 font-bold text-xs sm:text-sm">Biometria não cadastrada</p>
                  <p className="text-amber-600 text-[10px] sm:text-xs text-center">Utilize a Assinatura Manual.</p>
                  <button onClick={() => setAuthMethod('manual')} className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg text-[10px] font-black uppercase">Mudar para Manual</button>
                </div>
              ) : (
                <FaceCamera 
                  targetDescriptor={new Float32Array(employee.face_descriptor)}
                  onCapture={(_desc, img) => saveDelivery(img)}
                  onCancel={() => setAuthMethod('manual')}
                />
              )}
            </div>
          )}
        </div>
        
        <p className="text-center text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] pb-8">
          Segurança Certificada — {COMPANY_CONFIG.systemName}
        </p>
      </div>
    </div>
  )
}

export default function RemoteDeliveryPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-red-600" /></div>}>
      <RemoteDeliveryContent />
    </Suspense>
  )
}
