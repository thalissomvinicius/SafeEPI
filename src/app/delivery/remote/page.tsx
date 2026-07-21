"use client"

// ui: câmera/assinatura redesenhada — mobile-first ✓

import { useState, useRef, useEffect, Suspense, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import SignatureCanvas from "react-signature-canvas"
import { Camera, ExternalLink, FileDown, ShieldAlert, Fingerprint, PenLine, ShieldCheck, UserCheck, Lock } from "lucide-react"
import { api } from "@/services/api"
import { Delivery, Employee, PPE, Workplace } from "@/types/database"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { SignatureCapture } from "@/components/ui/SignatureCapture"
import { LoadingState } from "@/components/ui/LoadingState"
import { generateDeliveryPDF } from "@/utils/pdfGenerator"
import { COMPANY_CONFIG } from "@/config/company"
import { formatCpf } from "@/utils/cpf"
import { generateAuditCode } from "@/utils/auditCode"
import { toLocalDeliveryDateISOString } from "@/lib/dateOnly"
import { toast } from "@/lib/toast"
import { getSignatureDataUrl } from "@/utils/signatureCanvas"
import { isValidGeoLocation, requestRequiredGeolocation } from "@/utils/geolocation"

interface DeliveryData {
  e: string // employee id
  p: string // ppe id
  w: string // workplace id
  thirdPartyId?: string | null
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

type RemoteLinkResponse = {
  error?: string
  status?: string
  link: {
    token: string
    data: DeliveryData
    employee?: Employee | null
    ppe?: PPE | null
    workplace?: Workplace | null
  }
}

const dataUrlToImageFile = async (dataUrl: string, baseName: string) => {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const mimeType = blob.type || "image/png"
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png"
  return new File([blob], `${baseName}.${extension}`, { type: mimeType })
}

const getPdfDeliveryDate = (deliveryDate?: string | null) => {
  if (!deliveryDate) return undefined
  return deliveryDate.includes("T") ? deliveryDate : toLocalDeliveryDateISOString(deliveryDate)
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
  const [locationStatus, setLocationStatus] = useState<"idle" | "requesting" | "granted" | "blocked">("idle")
  const [locationError, setLocationError] = useState("")
  const [linkToken, setLinkToken] = useState<string>("")

  const requestLocationForSignature = useCallback(async (showToast = true) => {
    if (isValidGeoLocation(location)) {
      setLocationStatus("granted")
      setLocationError("")
      return location
    }

    setLocationStatus("requesting")
    const result = await requestRequiredGeolocation()

    if (result.ok) {
      setLocation(result.value)
      setLocationStatus("granted")
      setLocationError("")
      return result.value
    }

    setLocation("")
    setLocationStatus("blocked")
    setLocationError(result.message)
    if (showToast) {
      toast.error("Localização obrigatória", result.message)
    }
    return null
  }, [location])

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
    const t = searchParams.get('t') || searchParams.get('token')
    const controllers = new Set<AbortController>()
    let disposed = false

    const loadIpAddress = async () => {
      const controller = new AbortController()
      controllers.add(controller)
      const timeoutId = window.setTimeout(() => controller.abort(), 5000)

      try {
        const ipRes = await fetch('https://api.ipify.org?format=json', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!ipRes.ok) return
        const ipData = await ipRes.json() as { ip?: string }
        if (!disposed && ipData.ip) setIpAddress(ipData.ip)
      } catch {
        // O endereço IP é evidência complementar e não pode bloquear a assinatura.
      } finally {
        window.clearTimeout(timeoutId)
        controllers.delete(controller)
      }
    }
    
    const init = async () => {
      if (!t && !s) {
        setErrorMsg("Link inválido ou expirado.")
        setPhase('error')
        return
      }

      void loadIpAddress()

      try {
        let decoded: DeliveryData | null = null;
        let empFromToken: Employee | null = null;
        let ppeFromToken: PPE | null = null;
        let workplaceFromToken: Workplace | null = null;

        if (t) {
          // Token-based approach
          let res: Response
          const controller = new AbortController()
          controllers.add(controller)
          const timeoutId = window.setTimeout(() => controller.abort(), 15000)
          try {
            res = await fetch(`/api/remote-links?token=${encodeURIComponent(t)}`, {
              cache: 'no-store',
              signal: controller.signal,
            })
          } catch (fetchErr) {
            if (disposed) return
            console.error("[remote] Falha de rede ao buscar o link:", fetchErr)
            setErrorMsg(fetchErr instanceof DOMException && fetchErr.name === 'AbortError'
              ? "O servidor demorou para validar o link. Verifique sua internet e tente novamente."
              : "Sem conexão com o servidor. Verifique sua internet e tente abrir o link novamente.")
            setPhase('error')
            return
          } finally {
            window.clearTimeout(timeoutId)
            controllers.delete(controller)
          }

          let data: RemoteLinkResponse | null = null
          try {
            data = await res.json() as RemoteLinkResponse
          } catch (parseErr) {
            console.error("[remote] Resposta do servidor não é JSON válido:", parseErr, "status:", res.status)
            setErrorMsg("Resposta inválida do servidor. Tente novamente em instantes.")
            setPhase('error')
            return
          }

          if (!res.ok) {
            setErrorMsg(data?.error || "Link inválido.")
            setPhase(data?.status === 'completed' ? 'done' : 'error')
            return
          }

          if (!data?.link || typeof data.link !== "object") {
            console.error("[remote] Resposta do servidor sem o objeto link:", data)
            setErrorMsg("Link inválido ou expirado.")
            setPhase('error')
            return
          }

          decoded = (data.link.data || null) as DeliveryData | null;
          empFromToken = data.link.employee || null;
          ppeFromToken = data.link.ppe || null;
          workplaceFromToken = data.link.workplace || null;
          setLinkToken(data.link.token);

          if (!decoded) {
            console.error("[remote] Link sem dados de entrega anexados:", data.link)
            setErrorMsg("Este link não contém dados de entrega válidos. Solicite um novo link ao gestor.")
            setPhase('error')
            return
          }
        } else if (s) {
          // Legacy approach
          try {
            decoded = JSON.parse(atob(s))
          } catch (legacyErr) {
            console.error("[remote] Falha ao decodificar link legado:", legacyErr)
            setErrorMsg("Este link parece corrompido. Solicite um novo link ao gestor.")
            setPhase('error')
            return
          }
        }

        setDeliveryData(decoded)

        // O servidor (api/remote-links) já anexa employee/ppe/workplace ao token.
        // Não chamamos api.getEmployees/api.getPpes/api.getWorkplaces aqui porque essa
        // página é pública (link enviado por WhatsApp/e-mail) e essas APIs exigem auth.
        const emp = empFromToken
        const firstItemPpeId = decoded?.items?.[0]?.ppeId || decoded?.p
        const p = ppeFromToken
        const w = workplaceFromToken

        if (!emp) {
          console.error("[remote] Servidor não retornou employee para o token. decoded.e =", decoded?.e)
          setErrorMsg("Colaborador vinculado a este link não foi encontrado. Solicite um novo link ao gestor.")
          setPhase('error')
          return
        }
        if (!p) {
          console.error("[remote] Servidor não retornou ppe para o token. ppeId esperado =", firstItemPpeId, "decoded =", decoded)
          setErrorMsg("EPI vinculado a este link não foi encontrado. Solicite um novo link ao gestor.")
          setPhase('error')
          return
        }

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
      } catch (err) {
        console.error("[remote] Erro inesperado ao processar o link:", err)
        const message = err instanceof Error ? err.message : "erro desconhecido"
        setErrorMsg(`Erro ao processar o link de assinatura: ${message}`)
        setPhase('error')
      }
    }
    void init()

    return () => {
      disposed = true
      controllers.forEach((controller) => controller.abort())
      controllers.clear()
    }
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
    const requiredLocation = await requestLocationForSignature()
    if (!requiredLocation) return
    try {
      setIsSaving(true)
      const validationHash = generateAuditCode()
      
      const signatureFile = await dataUrlToImageFile(signatureDataUrl, "remote_signature")
      const photoBase64 = authMethod === 'manual_facial' ? capturedPhotoBase64 || undefined : undefined
      const persistedAuthMethod: Delivery['auth_method'] = authMethod

      const formData = new FormData()
      formData.append('employee_id', employee.id)
      const firstItem = deliveryItems[0]
      formData.append('ppe_id', firstItem?.ppeId || ppe.id)
      if (workplace?.id) formData.append('workplace_id', workplace.id)
      if (deliveryData?.thirdPartyId) formData.append('third_party_id', deliveryData.thirdPartyId)
      formData.append('reason', firstItem?.reason || deliveryData?.r || 'Primeira Entrega')
      formData.append('quantity', String(firstItem?.quantity || deliveryData?.q || 1))
      formData.append('ip_address', ipAddress || 'Remoto')
      formData.append('geo_location', requiredLocation)
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
      const authoritativeDeliveryDate = responseData.data?.delivery_date || responseData.deliveries?.[0]?.delivery_date || deliveryData?.deliveryDate
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
        location: requiredLocation,
        validationHash,
        deliveryDate: getPdfDeliveryDate(authoritativeDeliveryDate),
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
          geoLocation: requiredLocation,
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
        const lowerMessage = message.toLowerCase()
        const securityPolicyIssue = lowerMessage.includes("row-level security")
        const payloadTooLarge = lowerMessage.includes("function_payload_too_large")
          || lowerMessage.includes("request entity too large")
          || lowerMessage.includes("payload too large")

        if (payloadTooLarge) {
          console.warn("PDF assinado gerado, mas o arquivo juridico excedeu o limite da funcao:", archiveError)
        } else {
          toast.warning(securityPolicyIssue
            ? "Assinatura salva. O arquivo juridico nao foi arquivado por regra de seguranca do Storage."
            : message
          )
        }
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
  }, [employee, ppe, workplace, deliveryData, deliveryItems, authMethod, capturedPhotoBase64, ipAddress, linkToken, requestLocationForSignature])

  // ---------------------------------------
  // RENDER: Loading
  // ---------------------------------------
  if (phase === 'loading') return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] overflow-x-hidden bg-slate-50">
      <LoadingState
        variant="page"
        label="Validando link de assinatura"
        detail="Carregando entrega, colaborador e itens para conferencia."
      />
    </div>
  )

  // ---------------------------------------
  // RENDER: Error
  // ---------------------------------------
  if (phase === 'error') return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] overflow-x-hidden bg-slate-50 p-6 text-center">
      <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
      <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">{errorMsg}</h2>
      <p className="text-slate-500 mt-2 text-sm">Solicite um novo link ao gestor do SESMT.</p>
    </div>
  )

  // ---------------------------------------
  // RENDER: Done
  // ---------------------------------------
  if (phase === 'done') return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] overflow-x-hidden bg-slate-50 p-6 text-center animate-in zoom-in">
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
    <div className="min-h-[100dvh] overflow-x-hidden bg-slate-50 flex flex-col items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-md space-y-3 sm:space-y-6">
        <div className="text-center space-y-1.5">
          <div className="inline-block bg-[#2563EB] text-white text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] mb-2">Verificação de Identidade</div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 uppercase tracking-tighter">Confirme seus Dados</h1>
          <p className="text-slate-500 text-xs sm:text-sm">Para sua segurança, informe seus dados pessoais antes de assinar.</p>
        </div>

        <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-8 shadow-xl shadow-slate-200/50 border border-slate-200 space-y-4 sm:space-y-5">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 sm:hidden">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Itens pendentes</p>
            <p className="mt-1 text-sm font-black text-slate-900">
              {deliveryItems.length || 1} item{(deliveryItems.length || 1) !== 1 ? "s" : ""} para assinatura
            </p>
          </div>

          <div className="hidden bg-slate-50 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-slate-100 sm:block">
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

          <div className="hidden items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 sm:flex">
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

        <p className="hidden text-center text-[9px] sm:block sm:text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">
          Segurança Certificada - {COMPANY_CONFIG.systemName}
        </p>
      </div>
    </div>
  )

  // ---------------------------------------
  // RENDER: Signing Area (after CPF verified)
  // ---------------------------------------
  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-slate-50 flex flex-col items-center p-3 pt-4 sm:p-4 sm:pt-12">
      <div className="w-full min-w-0 max-w-lg space-y-3 sm:space-y-6">
        <div className="text-center space-y-1.5">
          <div className="inline-block bg-green-600 text-white text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] mb-2">✓ Identidade Verificada</div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 uppercase tracking-tighter">Confirmação de Recebimento</h1>
          <p className="text-slate-500 text-xs sm:text-sm font-medium">{employee?.full_name}</p>
        </div>

        {locationStatus !== "granted" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <p className="text-sm font-black uppercase tracking-wide text-amber-900">Localização obrigatória</p>
                  <p className="mt-1 text-sm font-medium leading-relaxed text-amber-800">
                    {locationError || "Permita a localização para concluir a assinatura e validar o PDF."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void requestLocationForSignature(true)}
                disabled={locationStatus === "requesting"}
                className="min-h-[44px] w-full rounded-xl bg-amber-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-amber-900/10 transition-all hover:bg-amber-700 disabled:opacity-60"
              >
                {locationStatus === "requesting" ? "Solicitando..." : "Permitir localização"}
              </button>
            </div>
          </div>
        )}

        <div className="w-full min-w-0 max-w-full space-y-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-200/50 sm:space-y-6 sm:rounded-3xl sm:p-6">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 sm:hidden">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Recebimento</p>
            <p className="mt-1 text-sm font-black text-slate-900">
              {deliveryItems.length} item{deliveryItems.length !== 1 ? "s" : ""} para confirmar
            </p>
          </div>

          <div className="hidden bg-slate-50 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-slate-100 sm:block">
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
          <div className="grid w-full min-w-0 max-w-full grid-cols-1 gap-1 overflow-hidden rounded-xl bg-slate-100 p-1 sm:grid-cols-3">
            <button onClick={() => { setAuthMethod('manual'); setCapturedPhotoBase64(null) }} className={`flex min-h-[44px] min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-center text-[10px] font-black uppercase tracking-wide transition-all sm:gap-2 sm:py-3 ${authMethod === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>
              <PenLine className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Manual
            </button>
            <button onClick={() => { setAuthMethod('manual_facial'); setCapturedPhotoBase64(null) }} className={`flex min-h-[44px] min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-center text-[10px] font-black uppercase tracking-wide transition-all sm:gap-2 sm:py-3 ${authMethod === 'manual_facial' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-400'}`}>
              <Camera className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Foto + Assin.
            </button>
            <button onClick={() => { setAuthMethod('facial'); setCapturedPhotoBase64(null) }} className={`flex min-h-[44px] min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-center text-[10px] font-black uppercase tracking-wide transition-all sm:gap-2 sm:py-3 ${authMethod === 'facial' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
              <Fingerprint className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Biometria
            </button>
          </div>

          {/* Manual signature */}
          {authMethod === 'manual' || authMethod === 'manual_facial' ? (
            <div className="space-y-3 sm:space-y-4 animate-in fade-in">
              {authMethod === 'manual_facial' && !capturedPhotoBase64 && (
                !employee?.photo_url ? (
                  <div className="bg-amber-50 border border-amber-200 p-4 sm:p-6 rounded-xl sm:rounded-2xl text-center space-y-2 sm:space-y-3">
                    <ShieldAlert className="w-7 h-7 sm:w-8 sm:h-8 text-amber-500 mx-auto" />
                    <p className="text-amber-800 font-bold text-xs sm:text-sm">Biometria nao cadastrada</p>
                    <p className="text-amber-600 text-[10px] sm:text-xs text-center">Solicite o cadastro da foto facial mestre ou use assinatura manual.</p>
                    <button onClick={() => setAuthMethod('manual')} className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg text-[10px] font-black uppercase">Mudar para Manual</button>
                  </div>
                ) : (
                  <FaceCamera
                    verifyEmployeeId={employee.id}
                    verifyCompanyId={employee.company_id}
                    verifyToken={linkToken}
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
              <div className="hidden justify-between items-center">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Assine no espaço abaixo:</label>
                <button onClick={() => sigCanvas.current?.clear()} className="text-[10px] font-black text-[#2563EB] uppercase italic">Limpar</button>
              </div>
              <SignatureCapture
                signatureRef={sigCanvas}
                isSaving={isSaving}
                confirmLabel="Confirmar recebimento"
                onConfirm={() => {
                  if (sigCanvas.current?.isEmpty()) return toast.error("Assine antes de confirmar.")
                  const signatureDataUrl = getSignatureDataUrl(sigCanvas.current)
                  if (!signatureDataUrl) return toast.error("Nao foi possivel ler a assinatura. Limpe e assine novamente.")
                  saveDelivery(signatureDataUrl)
                }}
              />
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4 animate-in zoom-in-95">
              {!employee?.photo_url ? (
                <div className="bg-amber-50 border border-amber-200 p-4 sm:p-6 rounded-xl sm:rounded-2xl text-center space-y-2 sm:space-y-3">
                  <ShieldAlert className="w-7 h-7 sm:w-8 sm:h-8 text-amber-500 mx-auto" />
                  <p className="text-amber-800 font-bold text-xs sm:text-sm">Biometria não cadastrada</p>
                  <p className="text-amber-600 text-[10px] sm:text-xs text-center">Utilize a Assinatura Manual.</p>
                  <button onClick={() => setAuthMethod('manual')} className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg text-[10px] font-black uppercase">Mudar para Manual</button>
                </div>
              ) : (
                <FaceCamera 
                  verifyEmployeeId={employee.id}
                  verifyCompanyId={employee.company_id}
                  verifyToken={linkToken}
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
    <Suspense fallback={<div className="flex min-h-[100dvh] items-center justify-center"><LoadingState variant="page" label="Abrindo assinatura" detail="Preparando o fluxo externo." /></div>}>
      <RemoteDeliveryContent />
    </Suspense>
  )
}
