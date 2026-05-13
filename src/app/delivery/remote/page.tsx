"use client"

import { useState, useRef, useEffect, Suspense, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import SignatureCanvas from "react-signature-canvas"
import { Camera, ExternalLink, FileDown, Loader2, ShieldAlert, Fingerprint, PenLine, ShieldCheck, UserCheck, Lock } from "lucide-react"
import { api } from "@/services/api"
import { Delivery, Employee, PPE, Workplace } from "@/types/database"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { generateDeliveryPDF } from "@/utils/pdfGenerator"
import { COMPANY_CONFIG } from "@/config/company"
import { formatCpf } from "@/utils/cpf"
import { generateAuditCode } from "@/utils/auditCode"
import { toLocalDeliveryDateISOString } from "@/lib/dateOnly"
import { toast } from "sonner"

interface DeliveryData {
  e: string // employee id
  p: string // ppe id
  w: string // workplace id
  q: number // quantity
  r: string // reason
  deliveryIds?: string[]
  deliveryDate?: string
  signaturePendingOnly?: boolean
  items?: {
    ppeId: string
    ppeName: string
    ppeCaNumber: string
    ppeCaExpiry: string
    quantity: number
    reason: string
    autoReturnNote?: string
  }[]
  autoReturnedDeliveryIds?: string[]
}

function RemoteDeliveryContent() {
  const searchParams = useSearchParams()
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  
  // -- Page states --
  const [phase, setPhase] = useState<'loading' | 'error' | 'verify' | 'sign' | 'done'>('loading')
  const [errorMsg, setErrorMsg] = useState("")

  // -- Verification form --
  const [inputCpf, setInputCpf] = useState("")
  const [verifyError, setVerifyError] = useState("")
  const [verifyAttempts, setVerifyAttempts] = useState(0)

  // -- Delivery data --
  const [deliveryData, setDeliveryData] = useState<DeliveryData | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [ppe, setPpe] = useState<PPE | null>(null)
  const [workplace, setWorkplace] = useState<Workplace | null>(null)
  const [deliveryItems, setDeliveryItems] = useState<NonNullable<DeliveryData["items"]>>([])

  // -- Signing --
  const [authMethod, setAuthMethod] = useState<'manual' | 'facial' | 'manual_facial'>('manual')
  const [capturedPhotoBase64, setCapturedPhotoBase64] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [lastPdfFileName, setLastPdfFileName] = useState<string | null>(null)

  // -- Metadata --
  const [ipAddress, setIpAddress] = useState("")
  const [location, setLocation] = useState("")
  const [linkToken, setLinkToken] = useState<string>("")

  // -- Auto-scroll to top on phase/method change --
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [phase, authMethod])

  useEffect(() => {
    return () => {
      if (lastPdfUrl) {
        window.URL.revokeObjectURL(lastPdfUrl)
      }
    }
  }, [lastPdfUrl])

  // -- Load delivery data on mount --
  useEffect(() => {
    const s = searchParams.get('s') // Legacy support
    const t = searchParams.get('t')
    
    const init = async () => {
      // Capture IP & location
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json')
        const ipData = await ipRes.json()
        setIpAddress(ipData.ip)
        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setLocation(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`)
            },
            (err) => {
              console.warn("Geolocation denied or unavailable:", err.message)
              setLocation("Permissão negada pelo dispositivo")
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
          )
        } else {
          setLocation("Navegador sem suporte a GPS")
        }
      } catch { /* ignore */ }

      try {
        let decoded: DeliveryData | null = null;
        let empFromToken = null;

        if (t) {
          // Token-based approach
          const res = await fetch(`/api/remote-links?token=${t}`)
          const data = await res.json()
          
          if (!res.ok) {
            setErrorMsg(data.error || "Link inválido.")
            setPhase(data.status === 'completed' ? 'done' : 'error')
            return
          }
          
          decoded = data.link.data as DeliveryData;
          empFromToken = data.link.employee;
          setLinkToken(data.link.token);
        } else if (s) {
          // Legacy approach
          decoded = JSON.parse(atob(s))
        } else {
          setErrorMsg("Link inválido ou expirado.")
          setPhase('error')
          return
        }

        setDeliveryData(decoded)
        
        const [employees, ppes, workplaces] = await Promise.all([
          !empFromToken ? api.getEmployees() : Promise.resolve([]),
          api.getPpes(),
          api.getWorkplaces()
        ])
        
        const emp = empFromToken || employees.find(e => e.id === decoded!.e)
        const firstItemPpeId = decoded?.items?.[0]?.ppeId || decoded!.p
        const p = ppes.find(p => p.id === firstItemPpeId)
        const w = workplaces.find(w => w.id === decoded!.w)

        if (!emp || !p) {
          setErrorMsg("Dados da entrega não encontrados no sistema.")
          setPhase('error')
        } else {
          setEmployee(emp)
          setPpe(p)
          setWorkplace(w || null)
          setDeliveryItems(decoded?.items && decoded.items.length > 0
            ? decoded.items
            : [{
              ppeId: p.id,
              ppeName: p.name,
              ppeCaNumber: p.ca_number,
              ppeCaExpiry: p.ca_expiry_date,
              quantity: decoded?.q || 1,
              reason: decoded?.r || "Entrega Remota",
            }]
          )
          setPhase('verify') // Go to identity verification
        }
      } catch {
        setErrorMsg("Erro ao processar o link de assinatura.")
        setPhase('error')
      }
    }
    init()
  }, [searchParams])

  const handleCpfChange = (value: string) => {
    setInputCpf(formatCpf(value))
    setVerifyError("")
  }

  // -- Identity verification --
  const handleVerify = () => {
    if (!employee) return
    
    if (!inputCpf.trim()) {
      setVerifyError("Informe seu CPF.")
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

    // CPF matches - proceed to signing
    setPhase('sign')
  }

  // -- Save delivery --
  const saveDelivery = useCallback(async (signatureDataUrl: string) => {
    if (!employee || !ppe) return
    if (authMethod === 'manual_facial' && !capturedPhotoBase64) {
      toast.error("Faça a verificação facial antes de confirmar a assinatura.")
      return
    }
    try {
      setIsSaving(true)
      const validationHash = generateAuditCode()
      
      const response = await fetch(signatureDataUrl)
      const blob = await response.blob()
      const signatureFile = new File([blob], "remote_signature.png", { type: "image/png" })
      const photoBase64 = authMethod === 'manual_facial' ? capturedPhotoBase64 || undefined : undefined
      const persistedAuthMethod: Delivery['auth_method'] = authMethod

      const formData = new FormData()
      formData.append('employee_id', employee.id)
      const firstItem = deliveryItems[0]
      formData.append('ppe_id', firstItem?.ppeId || ppe.id)
      if (workplace?.id) formData.append('workplace_id', workplace.id)
      formData.append('reason', firstItem?.reason || deliveryData?.r || 'Primeira Entrega')
      formData.append('quantity', String(firstItem?.quantity || deliveryData?.q || 1))
      formData.append('ip_address', ipAddress || 'Remoto')
      formData.append('auth_method', persistedAuthMethod)
      formData.append('signatureFile', signatureFile)
      if (linkToken) formData.append('token', linkToken) // Passa o token para o servidor

      const apiRes = await fetch('/api/remote-delivery', {
        method: 'POST',
        body: formData
      })
      
      const responseData = await apiRes.json()
      if (!apiRes.ok) throw new Error(responseData.error || "Erro ao salvar na nuvem")
      const autoReturnedDeliveryIds = Array.isArray(responseData.autoReturnedDeliveryIds)
        ? responseData.autoReturnedDeliveryIds as string[]
        : deliveryData?.autoReturnedDeliveryIds || []
      const deliveryIds = Array.isArray(responseData.deliveryIds)
        ? responseData.deliveryIds as string[]
        : deliveryData?.deliveryIds || (responseData.data?.id ? [responseData.data.id] : [])
      const autoReturnNote = autoReturnedDeliveryIds.length > 0
        ? `Baixa automatica do registro anterior${autoReturnedDeliveryIds.length > 1 ? ` (${autoReturnedDeliveryIds.length})` : ""}.`
        : undefined
      const pdfItems = deliveryItems.length > 0
        ? deliveryItems
        : [{
          ppeId: ppe.id,
          ppeName: ppe.name,
          ppeCaNumber: ppe.ca_number,
          ppeCaExpiry: ppe.ca_expiry_date,
          quantity: deliveryData?.q || 1,
          reason: deliveryData?.r || "Entrega Remota",
          autoReturnNote,
        }]

      const pdfBlob = await generateDeliveryPDF({
        employeeName: employee.full_name,
        employeeCpf: employee.cpf,
        employeeRole: employee.job_title,
        workplaceName: workplace?.name || "Sede",
        ppeName: pdfItems[0].ppeName,
        ppeCaNumber: pdfItems[0].ppeCaNumber,
        ppeCaExpiry: pdfItems[0].ppeCaExpiry,
        quantity: pdfItems[0].quantity,
        reason: pdfItems[0].reason,
        items: pdfItems.map((item) => ({
          ppeName: item.ppeName,
          ppeCaNumber: item.ppeCaNumber,
          caExpiry: item.ppeCaExpiry,
          quantity: item.quantity,
          reason: item.reason,
          autoReturnNote: item.autoReturnNote || autoReturnNote,
        })),
        authMethod,
        signatureBase64: signatureDataUrl,
        photoBase64,
        ipAddress,
        location,
        validationHash,
        deliveryDate: deliveryData?.deliveryDate ? toLocalDeliveryDateISOString(deliveryData.deliveryDate) : undefined,
      })

      const shortId = validationHash.slice(0, 8)
      const safeName = (employee.full_name || "Comprovante").split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const safePpe = (ppe.name || "EPI").split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const fileName = `Comprovante_${shortId}_${safeName}_${safePpe}.pdf`

      try {
        await api.archiveSignedDocument({
          documentType: "remote_delivery",
          employeeId: employee.id,
          deliveryId: deliveryIds[0] || responseData.data?.id,
          deliveryIds,
          fileName,
          pdfBlob,
          authMethod,
          signatureUrl: responseData.data?.signature_url,
          photoEvidenceBase64: photoBase64,
          ipAddress,
          geoLocation: location,
          linkToken,
          metadata: {
            validationHash,
            remoteLinkToken: linkToken,
            signaturePendingOnly: deliveryData?.signaturePendingOnly === true,
            workplaceName: workplace?.name || "Sede",
            items: pdfItems.map((item) => ({
              ppeId: item.ppeId,
              ppeName: item.ppeName,
              caNumber: item.ppeCaNumber,
              quantity: item.quantity,
              reason: item.reason,
            })),
            autoReturnedDeliveryIds,
            autoReturnNote,
          },
        })
      } catch (archiveError) {
        const message = archiveError instanceof Error ? archiveError.message : "Nao foi possivel arquivar o PDF assinado."
        const securityPolicyIssue = message.toLowerCase().includes("row-level security")
        toast.warning(securityPolicyIssue
          ? "Assinatura salva. O arquivo juridico nao foi arquivado por regra de seguranca do Storage."
          : message
        )
      }

      const pdfUrl = URL.createObjectURL(pdfBlob)
      setLastPdfUrl((prev) => {
        if (prev) {
          window.URL.revokeObjectURL(prev)
        }
        return pdfUrl
      })
      setLastPdfFileName(fileName)

      toast.success(autoReturnedDeliveryIds.length > 0
        ? "Assinatura salva, baixa automatica feita e comprovante gerado!"
        : "Assinatura salva e comprovante gerado!"
      )
      setPhase('done')
    } catch (err: unknown) {
      console.error(err)
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error("Erro ao salvar assinatura: " + message)
    } finally {
      setIsSaving(false)
    }
  }, [employee, ppe, workplace, deliveryData, deliveryItems, authMethod, capturedPhotoBase64, ipAddress, location, linkToken])

  // ---------------------------------------
  // RENDER: Loading
  // ---------------------------------------
  if (phase === 'loading') return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
      <Loader2 className="w-10 h-10 animate-spin text-[#2563EB] mb-4" />
      <p className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">Validando Link de Assinatura...</p>
    </div>
  )

  // ---------------------------------------
  // RENDER: Error
  // ---------------------------------------
  if (phase === 'error') return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
      <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">{errorMsg}</h2>
      <p className="text-slate-500 mt-2 text-sm">Solicite um novo link ao gestor do SESMT.</p>
    </div>
  )

  // ---------------------------------------
  // RENDER: Done
  // ---------------------------------------
  if (phase === 'done') return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center animate-in zoom-in">
      <div className="bg-green-100 p-4 rounded-full mb-6 text-green-600">
        <ShieldCheck className="w-16 h-16" />
      </div>
      <h2 className="text-2xl font-black text-slate-800 mb-2 uppercase tracking-tighter">Assinatura Confirmada</h2>
      <p className="text-slate-400 text-xs font-medium mb-2">Escolha se deseja visualizar o PDF em uma nova aba ou baixa-lo agora.</p>
      <p className="text-slate-500 max-w-md italic text-sm">O comprovante foi registrado e está disponível para download.</p>
      <div className="mt-8 flex flex-col gap-4 w-full max-w-xs">
        {lastPdfUrl && (
          <>
            <a href={lastPdfUrl} target="_blank" rel="noopener noreferrer" className="px-8 py-4 border border-slate-200 bg-white text-slate-700 rounded-xl font-bold shadow-sm flex items-center justify-center gap-2">
              <ExternalLink className="w-5 h-5 text-[#2563EB]" /> Visualizar PDF
            </a>
            <a href={lastPdfUrl} download={lastPdfFileName || "comprovante_safeepi.pdf"} className="px-8 py-4 bg-[#2563EB] text-white rounded-xl font-bold shadow-lg flex items-center justify-center gap-2">
              <FileDown className="w-5 h-5" /> Baixar PDF
            </a>
          </>
        )}
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pode fechar esta janela.</p>
      </div>
    </div>
  )

  // ---------------------------------------
  // RENDER: Identity Verification (CPF)
  // ---------------------------------------
  if (phase === 'verify') return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-block bg-[#2563EB] text-white text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] mb-2">Verificação de Identidade</div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 uppercase tracking-tighter">Confirme seus Dados</h1>
          <p className="text-slate-500 text-xs sm:text-sm">Para sua segurança, informe seus dados pessoais antes de assinar.</p>
        </div>

        <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-xl shadow-slate-200/50 border border-slate-200 space-y-5">
          <div className="bg-slate-50 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-slate-100">
            <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Item(ns) pendente(s) de assinatura:</p>
            <div className="space-y-2">
              {(deliveryItems.length > 0 ? deliveryItems : []).map((item) => (
                <div key={item.ppeId} className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                  <div className="flex justify-between gap-3">
                    <span className="font-bold text-slate-800 text-sm sm:text-base">{item.ppeName}</span>
                    <span className="bg-slate-200 text-slate-600 text-[9px] sm:text-[10px] font-black px-2 py-0.5 rounded self-start">Qtd: {item.quantity}</span>
                  </div>
                  <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">C.A.: {item.ppeCaNumber}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
            <Lock className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <p className="text-[10px] sm:text-[11px] text-blue-700 leading-tight">
              Informe seu <strong>CPF</strong> para confirmar sua identidade e liberar a assinatura.
            </p>
          </div>

          {/* Employee name from DB */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Colaborador</p>
            <p className="font-black text-slate-800 text-sm uppercase">{employee?.full_name}</p>
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
              className="w-full bg-slate-50 border-2 border-slate-100 text-slate-900 rounded-xl p-3 sm:p-4 outline-none focus:border-[#2563EB] transition-all font-bold text-sm tracking-wider"
              maxLength={14}
              autoComplete="off"
              autoFocus
            />
          </div>

          {/* Error message */}
          {verifyError && (
            <div className="bg-red-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2 animate-in fade-in">
              <ShieldAlert className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-[11px] sm:text-xs font-bold">{verifyError}</p>
            </div>
          )}

          {/* Submit */}
          <button 
            onClick={handleVerify}
            disabled={inputCpf.replace(/\D/g, '').length < 11}
            className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] active:bg-[#501010] disabled:bg-slate-300 text-white py-4 sm:py-5 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[11px] sm:text-xs transition-all shadow-lg flex items-center justify-center gap-2"
          >
            <UserCheck className="w-4 h-4" />
            Verificar Identidade
          </button>
        </div>

        <p className="text-center text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">
          Segurança Certificada - {COMPANY_CONFIG.systemName}
        </p>
      </div>
    </div>
  )

  // ---------------------------------------
  // RENDER: Signing Area (after CPF verified)
  // ---------------------------------------
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 pt-8 sm:pt-12">
      <div className="w-full max-w-lg space-y-4 sm:space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-block bg-green-600 text-white text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] mb-2">✓ Identidade Verificada</div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 uppercase tracking-tighter">Confirmação de Recebimento</h1>
          <p className="text-slate-500 text-xs sm:text-sm font-medium">{employee?.full_name} - {COMPANY_CONFIG.name}</p>
        </div>

        <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl shadow-slate-200/50 border border-slate-200 space-y-4 sm:space-y-6">
          <div className="bg-slate-50 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-slate-100">
            <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Item(ns) a ser assinado(s):</p>
            <div className="space-y-2">
              {deliveryItems.map((item) => (
                <div key={item.ppeId} className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                  <div className="flex justify-between gap-3">
                    <span className="font-bold text-slate-800 text-sm">{item.ppeName}</span>
                    <span className="bg-slate-200 text-slate-600 text-[9px] sm:text-[10px] font-black px-2 py-0.5 rounded self-start">Qtd: {item.quantity}</span>
                  </div>
                  <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">C.A.: {item.ppeCaNumber}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Auth method toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl">
            <button onClick={() => { setAuthMethod('manual'); setCapturedPhotoBase64(null) }} className={`py-2.5 sm:py-3 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${authMethod === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>
              <PenLine className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Manual
            </button>
            <button onClick={() => { setAuthMethod('manual_facial'); setCapturedPhotoBase64(null) }} className={`py-2.5 sm:py-3 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${authMethod === 'manual_facial' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-400'}`}>
              <Camera className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Foto + Assin.
            </button>
            <button onClick={() => { setAuthMethod('facial'); setCapturedPhotoBase64(null) }} className={`py-2.5 sm:py-3 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${authMethod === 'facial' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
              <Fingerprint className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Biometria
            </button>
          </div>

          {/* Manual signature */}
          {authMethod === 'manual' || authMethod === 'manual_facial' ? (
            <div className="space-y-3 sm:space-y-4 animate-in fade-in">
              {authMethod === 'manual_facial' && !capturedPhotoBase64 && (
                !employee?.face_descriptor ? (
                  <div className="bg-amber-50 border border-amber-200 p-4 sm:p-6 rounded-xl sm:rounded-2xl text-center space-y-2 sm:space-y-3">
                    <ShieldAlert className="w-7 h-7 sm:w-8 sm:h-8 text-amber-500 mx-auto" />
                    <p className="text-amber-800 font-bold text-xs sm:text-sm">Biometria nao cadastrada</p>
                    <p className="text-amber-600 text-[10px] sm:text-xs text-center">Solicite o cadastro da foto facial mestre ou use assinatura manual.</p>
                    <button onClick={() => setAuthMethod('manual')} className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg text-[10px] font-black uppercase">Mudar para Manual</button>
                  </div>
                ) : (
                  <FaceCamera
                    targetDescriptor={new Float32Array(employee.face_descriptor)}
                    onCapture={(_desc, img) => setCapturedPhotoBase64(img)}
                    onCancel={() => { setAuthMethod('manual'); setCapturedPhotoBase64(null) }}
                  />
                )
              )}
              {authMethod === 'manual_facial' && capturedPhotoBase64 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={capturedPhotoBase64} alt="Foto capturada agora" className="w-11 h-11 rounded-xl object-cover border border-emerald-200" />
                  <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest leading-relaxed">Identidade verificada. O comprovante vai sair com foto capturada agora e assinatura manual.</p>
                  <button
                    onClick={() => setCapturedPhotoBase64(null)}
                    title="Refazer foto"
                    className="ml-auto p-2 text-emerald-800 hover:bg-emerald-100 rounded-lg transition-all"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                </div>
              )}
              {(authMethod === 'manual' || capturedPhotoBase64) && (
                <>
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Assine no espaço abaixo:</label>
                <button onClick={() => sigCanvas.current?.clear()} className="text-[10px] font-black text-[#2563EB] uppercase italic">Limpar</button>
              </div>
              <div className="bg-white rounded-xl sm:rounded-2xl border-2 border-slate-100 h-48 sm:h-64 overflow-hidden touch-none">
                <SignatureCanvas ref={sigCanvas} canvasProps={{ className: 'w-full h-full' }} />
              </div>
              <button onClick={() => {
                if (sigCanvas.current?.isEmpty()) return alert("Assine antes de confirmar.")
                saveDelivery(sigCanvas.current!.getTrimmedCanvas().toDataURL())
              }} disabled={isSaving} className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] active:bg-[#501010] text-white py-4 sm:py-5 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[11px] sm:text-xs shadow-lg disabled:opacity-50 flex items-center justify-center">
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirmar Recebimento"}
              </button>
                </>
              )}
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
          Segurança Certificada - {COMPANY_CONFIG.systemName}
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
