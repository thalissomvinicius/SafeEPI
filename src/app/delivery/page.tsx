"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Image from "next/image"
import SignatureCanvas from "react-signature-canvas"
import { Camera, CheckCircle2, ExternalLink, FileDown, Loader2, ShieldAlert, Fingerprint, PenLine, Link2, Plus, Trash2, Package, Calendar, Clock, User, Clipboard, RefreshCw, Hourglass, XCircle } from "lucide-react"
import { format, addDays } from "date-fns"
import { api } from "@/services/api"
import { Employee, PPE, Workplace, Delivery, DeliveryWithRelations } from "@/types/database"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { generateDeliveryPDF } from "@/utils/pdfGenerator"
import { COMPANY_CONFIG } from "@/config/company"
import { formatCpf } from "@/utils/cpf"
import { generateAuditCode } from "@/utils/auditCode"
import { copyTextToClipboard } from "@/utils/clipboard"
import { toast } from "sonner"

interface CartItem {
  ppeId: string
  ppeName: string
  ppeCaNumber: string
  ppeCaExpiry: string
  quantity: number
  reason: string
  autoReturnDeliveryIds?: string[]
  autoReturnAllocations?: { deliveryId: string; quantity: number; deliveryDate: string }[]
  autoReturnNote?: string
}

type RemoteLinkStatus = "pending" | "completed" | "expired"

type PendingDeliveryDraft = {
  key: string
  token: string
  linkUrl: string
  status: RemoteLinkStatus
  expiresAt: string | null
  employeeId: string
  employeeName: string
  workplaceId: string
  workplaceName: string
  deliveryDate: string
  item: CartItem
}

const SUBSTITUTION_REASON = "Substituição (Desgaste/Validade)"

const getAutoReturnMotive = (reason: string) => {
  const normalized = reason
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

  if (normalized.includes("perda")) return "Baixa automatica por perda/extravio"
  if (normalized.includes("dano")) return "Baixa automatica por dano/quebra"
  return "Baixa automatica por substituicao"
}

const getRemainingDeliveryQuantity = (delivery: DeliveryWithRelations) =>
  Math.max(0, Number(delivery.quantity || 0) - Number(delivery.returned_quantity || 0))

export default function DeliveryPage() {
  const [step, setStep] = useState(1)
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  
  const [isSaved, setIsSaved] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [lastPdfFileName, setLastPdfFileName] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [viewMode, setViewMode] = useState<"new" | "pending">("new")
  const [pendingDrafts, setPendingDrafts] = useState<PendingDeliveryDraft[]>([])
  const [remoteWaitHours, setRemoteWaitHours] = useState(24)
  const [checkingPendingToken, setCheckingPendingToken] = useState<string | null>(null)

  // Metadados de Autenticidade
  const [ipAddress, setIpAddress] = useState<string>("")
  const [location, setLocation] = useState<string>("")

  // Dados do banco
  const [employees, setEmployees] = useState<Employee[]>([])
  const [ppes, setPpes] = useState<PPE[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [activeDeliveries, setActiveDeliveries] = useState<DeliveryWithRelations[]>([])
  const [loadingActiveDeliveries, setLoadingActiveDeliveries] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(true)

  // Estados dos formulários selecionados
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("")
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState("")
  const [ppeSearchTerm, setPpeSearchTerm] = useState("")
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState("")
  const [deliveryDate, setDeliveryDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))

  // â”€â”€ CART: Multi-EPI â”€â”€
  const [cart, setCart] = useState<CartItem[]>([])
  const [currentPpeId, setCurrentPpeId] = useState("")
  const [currentQuantity, setCurrentQuantity] = useState(1)
  const [currentReason, setCurrentReason] = useState("Primeira Entrega")

  // Biometria Facial
  const [authMethod, setAuthMethod] = useState<'manual' | 'facial' | 'manual_facial'>('manual')
  const [capturedPhotoBase64, setCapturedPhotoBase64] = useState<string | null>(null)

  useEffect(() => {
    const captureMetadata = async () => {
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
        } catch (e) { console.error("Erro ao capturar metadados:", e) }
    }
    captureMetadata()

    async function loadOptions() {
      try {
        const [empData, ppeData, wpData] = await Promise.all([
          api.getEmployees(),
          api.getPpes(),
          api.getWorkplaces()
        ])
        setEmployees(empData.filter(e => e.active))
        setPpes(ppeData.filter(p => p.active))
        setWorkplaces(wpData)
        
        if (empData.length > 0) {
            setSelectedEmployeeId(empData[0].id)
            setSelectedWorkplaceId(empData[0].workplace_id || "")
        }
        if (ppeData.length > 0) setCurrentPpeId(ppeData[0].id)
      } catch (error) {
        console.error("Erro ao carregar opções:", error)
      } finally {
        setLoadingOptions(false)
      }
    }

    loadOptions()
  }, [])

  useEffect(() => {
    return () => {
      if (lastPdfUrl) {
        window.URL.revokeObjectURL(lastPdfUrl)
      }
    }
  }, [lastPdfUrl])

  useEffect(() => {
    if (!selectedEmployeeId) {
      const timer = window.setTimeout(() => setActiveDeliveries([]), 0)
      return () => window.clearTimeout(timer)
    }

    const timer = window.setTimeout(() => {
      const loadEmployeeActiveDeliveries = async () => {
        try {
          setLoadingActiveDeliveries(true)
          const history = await api.getEmployeeHistory(selectedEmployeeId)
          setActiveDeliveries(history.filter(delivery => !delivery.returned_at && getRemainingDeliveryQuantity(delivery) > 0))
        } catch (err) {
          console.error("Erro ao carregar EPIs ativos do colaborador:", err)
          setActiveDeliveries([])
        } finally {
          setLoadingActiveDeliveries(false)
        }
      }

      void loadEmployeeActiveDeliveries()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [selectedEmployeeId])

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId)
  const currentPpe = ppes.find(p => p.id === currentPpeId)
  const selectedWorkplace = workplaces.find(w => w.id === selectedWorkplaceId)
  const currentActiveSamePpeDeliveries = activeDeliveries.filter(delivery => delivery.ppe_id === currentPpeId && !delivery.returned_at)

  const shouldAutoReturn = (reason: string, deliveries = currentActiveSamePpeDeliveries) =>
    deliveries.length > 0 && reason !== "Primeira Entrega"

  const effectiveCurrentReason = currentActiveSamePpeDeliveries.length > 0 && currentReason === "Primeira Entrega"
    ? SUBSTITUTION_REASON
    : currentReason

  const formatRemoteExpiry = (value: string | null) => {
    if (!value) return "sem prazo"
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const loadPendingDrafts = useCallback(() => {
    if (typeof window === "undefined") return

    const drafts: PendingDeliveryDraft[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith("delivery-signature:")) continue

      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || "{}") as PendingDeliveryDraft
        if (!parsed.token || !parsed.item) continue
        drafts.push({ ...parsed, key, status: parsed.status || "pending" })
      } catch {
        window.localStorage.removeItem(key)
      }
    }

    setPendingDrafts(drafts.sort((a, b) => (b.expiresAt || "").localeCompare(a.expiresAt || "")))
  }, [])

  const persistPendingDraft = useCallback((draft: Omit<PendingDeliveryDraft, "key">) => {
    if (typeof window === "undefined") return
    const key = `delivery-signature:${draft.token}`
    window.localStorage.setItem(key, JSON.stringify({ ...draft, key }))
    loadPendingDrafts()
  }, [loadPendingDrafts])

  const updatePendingDraft = useCallback((token: string, updates: Partial<PendingDeliveryDraft>) => {
    if (typeof window === "undefined") return
    const key = `delivery-signature:${token}`
    const current = window.localStorage.getItem(key)
    if (!current) return

    try {
      const parsed = JSON.parse(current) as PendingDeliveryDraft
      window.localStorage.setItem(key, JSON.stringify({ ...parsed, ...updates, key }))
      loadPendingDrafts()
    } catch {
      window.localStorage.removeItem(key)
      loadPendingDrafts()
    }
  }, [loadPendingDrafts])

  const removePendingDraft = useCallback((token: string) => {
    if (typeof window === "undefined") return
    window.localStorage.removeItem(`delivery-signature:${token}`)
    loadPendingDrafts()
  }, [loadPendingDrafts])

  const isCurrentPpeExpired = currentPpe ? new Date(currentPpe.ca_expiry_date).getTime() < new Date().setHours(0, 0, 0, 0) : false

  const filteredPpes = ppes.filter(ppe => 
    ppe.name.toLowerCase().includes(ppeSearchTerm.toLowerCase()) || 
    ppe.ca_number.includes(ppeSearchTerm)
  )

  const filteredEmployees = employees.filter(emp => 
    emp.full_name.toLowerCase().includes(employeeSearchTerm.toLowerCase()) || 
    (emp.cpf && emp.cpf.includes(employeeSearchTerm))
  )

  const handleEmployeeChange = (empId: string) => {
    setSelectedEmployeeId(empId)
    setCapturedPhotoBase64(null)
    const emp = employees.find(e => e.id === empId)
    if (emp && emp.workplace_id) {
        setSelectedWorkplaceId(emp.workplace_id)
    } else {
        setSelectedWorkplaceId("")
    }
  }

  // â”€â”€ Cart operations â”€â”€
  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadPendingDrafts()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadPendingDrafts])

  const addToCart = () => {
    if (!currentPpe) return
    if (isCurrentPpeExpired) {
      toast.error("EPI com CA vencido não pode ser entregue.")
      return
    }
    
    // Verificação de Estoque
    const totalInCart = cart.reduce((acc, item) => item.ppeId === currentPpeId ? acc + item.quantity : acc, 0)
    if (totalInCart + currentQuantity > currentPpe.current_stock) {
      toast.error(`Estoque Insuficiente! Você possui apenas ${currentPpe.current_stock} unidades de ${currentPpe.name} no estoque. Por favor, adicione mais estoque primeiro.`)
      return
    }

    if (cart.some(item => item.ppeId === currentPpeId)) {
      toast.error("Este EPI já está na lista. Remova-o se quiser alterar a quantidade.")
      return
    }

    const selectedReason = effectiveCurrentReason
    const autoReturnAllocations: { deliveryId: string; quantity: number; deliveryDate: string }[] = []
    if (shouldAutoReturn(selectedReason)) {
      let pendingReturnQuantity = currentQuantity
      for (const delivery of currentActiveSamePpeDeliveries) {
        if (pendingReturnQuantity <= 0) break
        const available = getRemainingDeliveryQuantity(delivery)
        if (available <= 0) continue
        const quantityToReturn = Math.min(available, pendingReturnQuantity)
        autoReturnAllocations.push({
          deliveryId: delivery.id,
          quantity: quantityToReturn,
          deliveryDate: delivery.delivery_date,
        })
        pendingReturnQuantity -= quantityToReturn
      }
    }
    const autoReturnDeliveryIds = autoReturnAllocations.map(item => item.deliveryId)
    const autoReturnQuantity = autoReturnAllocations.reduce((acc, item) => acc + item.quantity, 0)
    const firstAutoReturnDelivery = autoReturnAllocations[0]

    setCart(prev => [...prev, {
      ppeId: currentPpeId,
      ppeName: currentPpe.name,
      ppeCaNumber: currentPpe.ca_number,
      ppeCaExpiry: currentPpe.ca_expiry_date,
      quantity: currentQuantity,
      reason: selectedReason,
      autoReturnDeliveryIds,
      autoReturnAllocations,
      autoReturnNote: autoReturnQuantity > 0
        ? `Baixa automatica de ${autoReturnQuantity} un.${autoReturnAllocations.length > 1 ? ` em ${autoReturnAllocations.length} registros` : ""}${firstAutoReturnDelivery ? ` da entrega de ${format(new Date(firstAutoReturnDelivery.deliveryDate), "dd/MM/yyyy")}` : ""}.`
        : undefined
    }])
    setCurrentQuantity(1)
    setPpeSearchTerm("")
    toast.success(autoReturnQuantity > 0
      ? `${currentPpe.name} adicionado com baixa automatica de ${autoReturnQuantity} unidade(s).`
      : `${currentPpe.name} adicionado Ã  entrega.`
    )
  }

  const removeFromCart = (ppeId: string) => {
    setCart(prev => prev.filter(item => item.ppeId !== ppeId))
  }

  const validateCartForDelivery = useCallback(() => {
    for (const item of cart) {
      const ppe = ppes.find((candidate) => candidate.id === item.ppeId)
      if (!ppe) {
        toast.error(`EPI ${item.ppeName} nao encontrado no catalogo.`)
        return false
      }

      const caExpired = new Date(ppe.ca_expiry_date).getTime() < new Date().setHours(0, 0, 0, 0)
      if (caExpired) {
        toast.error(`CA vencido: ${ppe.name}. Atualize o CA antes da entrega.`)
        return false
      }

      if ((ppe.current_stock || 0) < item.quantity) {
        toast.error(`Estoque insuficiente para ${ppe.name}. Saldo atual: ${ppe.current_stock || 0}.`)
        return false
      }
    }

    return true
  }, [cart, ppes])

  const clearSignature = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear()
    }
  }

  const saveDelivery = useCallback(async (signatureDataUrl: string) => {
    if (cart.length === 0) {
      toast.error("Adicione pelo menos um EPI Ã  lista de entrega.")
      return
    }
    if (!validateCartForDelivery()) return

    try {
      setIsSaving(true)
      
      const validationHash = generateAuditCode()
      
      const response = await fetch(signatureDataUrl)
      const blob = await response.blob()
      const signatureFile = new File([blob], "signature.png", { type: "image/png" })
      const photoBase64 = authMethod === 'manual_facial' ? capturedPhotoBase64 || undefined : undefined
      const persistedAuthMethod: Delivery['auth_method'] = authMethod

      const savedDeliveries: Delivery[] = []
      const autoReturnedDeliveryIds: string[] = []

      // Save each item as a separate delivery record (same signature)
      for (const item of cart) {
        const savedDelivery = await api.saveDelivery({
          employee_id: selectedEmployeeId,
          ppe_id: item.ppeId,
          workplace_id: selectedWorkplaceId || null,
          reason: item.reason as Delivery['reason'],
          quantity: item.quantity,
          ip_address: ipAddress || "Desconhecido",
          auth_method: persistedAuthMethod,
          signature_url: null,
          delivery_date: new Date(deliveryDate).toISOString()
        }, signatureFile)
        savedDeliveries.push(savedDelivery as Delivery)

        const previousAllocations = item.autoReturnAllocations || (item.autoReturnDeliveryIds || []).map(deliveryId => ({
          deliveryId,
          quantity: item.quantity,
          deliveryDate: "",
        }))
        for (const allocation of previousAllocations) {
          if (allocation.deliveryId === (savedDelivery as Delivery).id) continue
          await api.returnDeliveryQuantity(allocation.deliveryId, getAutoReturnMotive(item.reason), allocation.quantity)
          autoReturnedDeliveryIds.push(allocation.deliveryId)
        }
      }

      // Generate ONE PDF with all items
      const pdfBlob = await generateDeliveryPDF({
        employeeName: selectedEmployee?.full_name || "",
        employeeCpf: selectedEmployee?.cpf || "",
        employeeRole: selectedEmployee?.job_title || "",
        workplaceName: selectedWorkplace?.name || "Sede",
        ppeName: cart[0].ppeName,
        ppeCaNumber: cart[0].ppeCaNumber,
        ppeCaExpiry: cart[0].ppeCaExpiry,
        quantity: cart[0].quantity,
        reason: cart[0].reason,
        items: cart.map(item => ({
          ppeName: item.ppeName,
          ppeCaNumber: item.ppeCaNumber,
          caExpiry: item.ppeCaExpiry,
          quantity: item.quantity,
          reason: item.reason,
          autoReturnNote: item.autoReturnNote
        })),
        authMethod,
        signatureBase64: signatureDataUrl,
        photoBase64,
        ipAddress,
        location,
        validationHash,
        deliveryDate: new Date(deliveryDate).toISOString()
      })
      
      const shortId = validationHash.slice(0, 8)
      const safeName = (selectedEmployee?.full_name || "Comprovante").split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const itemCount = cart.length > 1 ? `${cart.length}EPIs` : cart[0].ppeName.split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const fileName = `Comprovante_${shortId}_${safeName}_${itemCount}.pdf`

      try {
        await api.archiveSignedDocument({
          documentType: "delivery",
          employeeId: selectedEmployeeId,
          deliveryIds: savedDeliveries.map((delivery) => delivery.id).filter(Boolean),
          fileName,
          pdfBlob,
          authMethod,
          signatureUrl: savedDeliveries[0]?.signature_url,
          photoEvidenceBase64: photoBase64,
          ipAddress,
          geoLocation: location,
          metadata: {
            validationHash,
            workplaceName: selectedWorkplace?.name || "Sede",
            itemCount: cart.length,
            items: cart.map((item) => ({
              ppeId: item.ppeId,
              ppeName: item.ppeName,
              caNumber: item.ppeCaNumber,
              quantity: item.quantity,
              reason: item.reason,
              autoReturnDeliveryIds: item.autoReturnDeliveryIds || [],
              autoReturnNote: item.autoReturnNote,
            })),
            autoReturnedDeliveryIds,
          },
        })
      } catch (archiveError) {
        const message = archiveError instanceof Error ? archiveError.message : "Nao foi possivel arquivar o PDF assinado."
        toast.warning(message)
      }
      
      const pdfUrl = URL.createObjectURL(pdfBlob)
      setLastPdfUrl((prev) => {
        if (prev) {
          window.URL.revokeObjectURL(prev)
        }
        return pdfUrl
      })
      setLastPdfFileName(fileName)
      setIsSaved(true)
      if (autoReturnedDeliveryIds.length > 0) {
        setActiveDeliveries(prev => prev
          .map(delivery => {
            const returnedForDelivery = cart
              .flatMap(item => item.autoReturnAllocations || [])
              .filter(allocation => allocation.deliveryId === delivery.id)
              .reduce((acc, allocation) => acc + allocation.quantity, 0)

            if (returnedForDelivery <= 0) return delivery
            return {
              ...delivery,
              returned_quantity: Number(delivery.returned_quantity || 0) + returnedForDelivery,
            }
          })
          .filter(delivery => getRemainingDeliveryQuantity(delivery) > 0)
        )
      }

      toast.success(autoReturnedDeliveryIds.length > 0
        ? `Entrega registrada com ${autoReturnedDeliveryIds.length} baixa(s) automatica(s).`
        : `Entrega de ${cart.length} EPI(s) registrada com sucesso!`
      )
    } catch (err: unknown) {
      console.error("Erro ao finalizar entrega:", err)
      const message = err instanceof Error ? err.message : "Erro ao salvar entrega."
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }, [selectedEmployeeId, selectedWorkplaceId, cart, ipAddress, location, authMethod, capturedPhotoBase64, selectedEmployee, selectedWorkplace, deliveryDate, validateCartForDelivery])

  const handleManualSave = () => {
    if (authMethod === 'manual_facial' && !capturedPhotoBase64) {
      toast.error("Faça a verificação facial antes de confirmar a assinatura.")
      return
    }
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      toast.error("A assinatura é obrigatória.")
      return
    }
    const signatureDataUrl = sigCanvas.current.getTrimmedCanvas().toDataURL("image/png")
    saveDelivery(signatureDataUrl)
  }

  const handleFaceCapture = (descriptor: Float32Array, imageBase64: string) => {
    saveDelivery(imageBase64)
  }

  const generateRemoteLink = async () => {
      if (cart.length === 0) {
        toast.error("Adicione pelo menos um EPI Ã  lista antes de gerar o link.")
	        return
	      }
      if (cart.length > 1) {
        toast.error("Assinatura remota aceita 1 EPI por link. Gere um link separado para cada entrega.")
        return
      }
      if (!validateCartForDelivery()) return
	      const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
      const deliveryDataPayload = {
          e: selectedEmployeeId,
          p: cart[0].ppeId,
          w: selectedWorkplaceId,
          q: cart[0].quantity,
          r: cart[0].reason
      }

      try {
        const data = await api.createRemoteLink({
          employee_id: selectedEmployeeId,
          type: 'delivery',
          data: deliveryDataPayload,
          expires_hours: remoteWaitHours
        })
        const url = `${baseUrl}/delivery/remote?t=${data.link.token}`
        persistPendingDraft({
          token: data.link.token,
          linkUrl: url,
          status: "pending",
          expiresAt: data.link.expires_at,
          employeeId: selectedEmployeeId,
          employeeName: selectedEmployee?.full_name || "Colaborador",
          workplaceId: selectedWorkplaceId,
          workplaceName: selectedWorkplace?.name || "Sede",
          deliveryDate,
          item: cart[0],
        })
        const copied = await copyTextToClipboard(url)
        setViewMode("pending")
        if (copied) {
          toast.success(`Link de assinatura remota copiado. Valido por ${remoteWaitHours}h e uso unico.`)
        } else {
          toast.warning("Link gerado e salvo em Pendencias. Use o botao Copiar ou copie manualmente.")
        }
        return
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
        toast.error(`Erro ao gerar link: ${errorMsg}.`);
      }
  }

  const checkPendingDraft = useCallback(async (draft: PendingDeliveryDraft) => {
    try {
      setCheckingPendingToken(draft.token)
      const res = await fetch(`/api/remote-links?token=${draft.token}&include_completed=1`)
      const payload = await res.json()

      if (!res.ok) {
        if (payload.status === "expired") {
          updatePendingDraft(draft.token, { status: "expired" })
          toast.warning("Link expirado. Gere uma nova assinatura remota para esta entrega.")
        } else {
          toast.error(payload.error || "Nao foi possivel consultar esta pendencia.")
        }
        return
      }

      const status = payload.link?.status as RemoteLinkStatus | undefined
      if (status === "completed") {
        updatePendingDraft(draft.token, { status: "completed" })
        toast.success("Assinatura do colaborador concluida e entrega registrada.")
        return
      }

      if (payload.link?.expires_at && new Date(payload.link.expires_at) < new Date()) {
        updatePendingDraft(draft.token, { status: "expired", expiresAt: payload.link.expires_at })
        toast.warning("Link expirado. Gere uma nova assinatura remota para esta entrega.")
        return
      }

      updatePendingDraft(draft.token, {
        status: "pending",
        expiresAt: payload.link?.expires_at || draft.expiresAt,
      })
      toast.info("Ainda aguardando assinatura do colaborador.")
    } catch (err) {
      console.error("Erro ao consultar pendencia de assinatura:", err)
      toast.error("Erro ao consultar a pendencia.")
    } finally {
      setCheckingPendingToken(null)
    }
  }, [updatePendingDraft])

  const restorePendingDraft = (draft: PendingDeliveryDraft) => {
    setSelectedEmployeeId(draft.employeeId)
    setSelectedWorkplaceId(draft.workplaceId)
    setDeliveryDate(draft.deliveryDate)
    setCurrentPpeId(draft.item.ppeId)
    setCurrentQuantity(draft.item.quantity)
    setCurrentReason(draft.item.reason)
    setCart([draft.item])
    setStep(1)
    setViewMode("new")
  }

  if (loadingOptions) {
      return (
          <div className="flex flex-col items-center justify-center py-40">
              <Loader2 className="w-10 h-10 animate-spin text-[#2563EB] mb-4" />
              <p className="font-bold text-slate-500 uppercase tracking-widest text-xs italic">Sincronizando Sessão {COMPANY_CONFIG.shortName}...</p>
          </div>
      )
  }

  if (isSaved) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[70vh] p-6 animate-in zoom-in duration-500 text-center">
        <div className="bg-red-50 p-4 rounded-full mb-6 text-[#2563EB]">
          <CheckCircle2 className="w-16 h-16" />
        </div>
        <h2 className="text-2xl font-black text-slate-800 mb-2 uppercase tracking-tighter italic">Comprovante Digital Gerado</h2>
        <p className="mt-2 text-xs font-medium text-slate-400">Escolha se deseja apenas visualizar o PDF ou baixa-lo agora.</p>
        <p className="text-slate-500 max-w-md italic text-sm">{cart.length} EPI(s) registrado(s) • IP {ipAddress || '...'}</p>
        
        <div className="mt-8 flex flex-col sm:flex-row gap-4">
          {lastPdfUrl && (
            <>
              <a
                href={lastPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-4 bg-white hover:bg-slate-50 text-slate-700 rounded-xl font-bold transition-all border border-slate-200 shadow-sm flex items-center justify-center"
              >
                <ExternalLink className="w-5 h-5 mr-3 text-[#2563EB]" />
                Visualizar PDF
              </a>
              <a
                href={lastPdfUrl}
                download={lastPdfFileName || `ficha_epi_${COMPANY_CONFIG.shortName.toLowerCase()}.pdf`}
                className="px-8 py-4 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-900/10 flex items-center justify-center shadow-lg shadow-blue-900/15"
              >
                <FileDown className="w-5 h-5 mr-3" />
                Baixar PDF
              </a>
            </>
          )}
          <button 
            onClick={() => { setIsSaved(false); setStep(1); setLastPdfUrl(null); setLastPdfFileName(null); setCart([]); }}
            className="px-8 py-4 bg-white hover:bg-slate-50 text-slate-600 rounded-xl font-bold transition-all border border-slate-200 shadow-sm"
          >
            Nova Entrega
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto pb-24 lg:pb-8">
      <div className="mb-6 lg:mb-8 border-l-4 border-[#2563EB] pl-4">
        <h1 className="text-2xl lg:text-3xl font-black text-slate-800 uppercase tracking-tighter">Terminal de Entregas Digital {COMPANY_CONFIG.shortName}</h1>
        <p className="text-slate-500 font-medium text-sm lg:text-base mt-1">Compliance NR-06 com Rastreabilidade de Autoria.</p>
      </div>

      <div className="mb-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="grid grid-cols-2 bg-slate-100 border border-slate-200 p-1 rounded-2xl w-full lg:w-auto">
          <button
            onClick={() => setViewMode("new")}
            className={`px-4 sm:px-6 py-3 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${viewMode === "new" ? "bg-white text-[#2563EB] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            <Plus className="w-4 h-4" /> Nova Entrega
          </button>
          <button
            onClick={() => setViewMode("pending")}
            className={`px-4 sm:px-6 py-3 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${viewMode === "pending" ? "bg-white text-amber-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            <Hourglass className="w-4 h-4" /> Pendencias
            {pendingDrafts.length > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[10px] flex items-center justify-center">
                {pendingDrafts.length}
              </span>
            )}
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center justify-between gap-4 shadow-sm">
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Espera da assinatura</p>
            <p className="text-[10px] text-slate-400 font-bold">Validade do link remoto.</p>
          </div>
          <select
            value={remoteWaitHours}
            onChange={(event) => setRemoteWaitHours(Number(event.target.value))}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-700 outline-none focus:border-[#2563EB]"
            title="Tempo de espera da assinatura"
          >
            <option value={1}>1h</option>
            <option value={4}>4h</option>
            <option value={8}>8h</option>
            <option value={12}>12h</option>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
          </select>
        </div>
      </div>

      {viewMode === "pending" ? (
        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xl shadow-slate-200/40 animate-in fade-in">
          <div className="p-5 sm:p-6 border-b border-slate-100 bg-amber-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                <Hourglass className="w-5 h-5 text-amber-600" />
                Pendencias de Assinatura
              </h2>
              <p className="text-xs text-amber-700 font-bold mt-1">Entregas de EPI aguardando assinatura do colaborador.</p>
            </div>
            <button
              onClick={() => pendingDrafts.forEach((draft) => { if (draft.status === "pending") void checkPendingDraft(draft) })}
              disabled={pendingDrafts.length === 0 || checkingPendingToken !== null}
              className="bg-white border border-amber-200 text-amber-700 px-4 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-amber-50 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${checkingPendingToken ? "animate-spin" : ""}`} /> Atualizar Status
            </button>
          </div>

          <div className="p-4 sm:p-6">
            {pendingDrafts.length === 0 ? (
              <div className="py-16 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50">
                <CheckCircle2 className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-black text-slate-500 uppercase tracking-widest">Nenhuma pendencia de assinatura</p>
                <p className="text-xs text-slate-400 mt-2 font-medium">Quando gerar um link remoto de EPI, ele aparece aqui.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pendingDrafts.map((draft) => {
                  const isChecking = checkingPendingToken === draft.token
                  const statusStyle = draft.status === "completed"
                    ? "bg-green-50 text-green-700 border-green-200"
                    : draft.status === "expired"
                      ? "bg-red-50 text-red-700 border-blue-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  const StatusIcon = draft.status === "completed" ? CheckCircle2 : draft.status === "expired" ? XCircle : Hourglass

                  return (
                    <div key={draft.token} className="border border-slate-200 rounded-2xl p-4 sm:p-5 bg-white shadow-sm hover:shadow-md transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-800 uppercase tracking-tight truncate">{draft.employeeName}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{draft.workplaceName} - {new Date(`${draft.deliveryDate}T12:00:00`).toLocaleDateString("pt-BR")}</p>
                        </div>
                        <span className={`px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 whitespace-nowrap ${statusStyle}`}>
                          <StatusIcon className="w-3 h-3" />
                          {draft.status === "completed" ? "Assinada" : draft.status === "expired" ? "Expirada" : "Aguardando"}
                        </span>
                      </div>

                      <div className="mt-4 bg-slate-50 border border-slate-100 rounded-2xl p-4">
                        <p className="font-black text-xs text-slate-800 uppercase tracking-tight">{draft.item.ppeName}</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-[9px] font-bold bg-white text-slate-500 px-2 py-0.5 rounded border border-slate-200">CA {draft.item.ppeCaNumber}</span>
                          <span className="text-[9px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Qtd: {draft.item.quantity}</span>
                          <span className="text-[9px] font-bold text-slate-400">{draft.item.reason}</span>
                          {draft.item.autoReturnDeliveryIds && draft.item.autoReturnDeliveryIds.length > 0 && (
                            <span className="text-[9px] font-black bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200">Baixa automática</span>
                          )}
                        </div>
                        {draft.item.autoReturnNote && (
                          <p className="mt-3 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 inline-flex">
                            {draft.item.autoReturnNote}
                          </p>
                        )}
                      </div>

                      <div className="mt-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                        <Clock className="w-3.5 h-3.5" />
                        {draft.status === "pending" ? `Assinatura do colaborador aguardando ate ${formatRemoteExpiry(draft.expiresAt)}` : `Ultimo prazo: ${formatRemoteExpiry(draft.expiresAt)}`}
                      </div>

                      <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <button
                          onClick={() => void copyTextToClipboard(draft.linkUrl).then((copied) => {
                            if (copied) {
                              toast.success("Link copiado novamente.")
                            } else {
                              toast.warning("Nao foi possivel copiar automaticamente. Abra o link e copie pela barra do navegador.")
                            }
                          })}
                          className="py-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5"
                        >
                          <Clipboard className="w-3.5 h-3.5" /> Copiar
                        </button>
                        <a
                          href={draft.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Abrir
                        </a>
                        <button
                          onClick={() => void checkPendingDraft(draft)}
                          disabled={isChecking}
                          className="py-3 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? "animate-spin" : ""}`} /> Checar
                        </button>
                        <button
                          onClick={() => restorePendingDraft(draft)}
                          className="py-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5"
                        >
                          <Package className="w-3.5 h-3.5" /> Reabrir
                        </button>
                        <button
                          onClick={() => removePendingDraft(draft.token)}
                          className="py-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Limpar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : (

      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xl shadow-slate-200/40">
        {/* Progress Bar Header */}
        <div className="flex bg-slate-50 border-b border-slate-100">
          <div className={`flex-1 text-center py-4 lg:py-5 text-[10px] lg:text-xs font-black uppercase tracking-[0.2em] transition-all duration-300 ${step === 1 ? 'bg-white text-[#2563EB] border-b-2 border-[#2563EB]' : 'text-slate-400 border-b-2 border-transparent'}`}>1. Seleção e Carrinho</div>
          <div className={`flex-1 text-center py-4 lg:py-5 text-[10px] lg:text-xs font-black uppercase tracking-[0.2em] transition-all duration-300 ${step === 2 ? 'bg-white text-[#2563EB] border-b-2 border-[#2563EB]' : 'text-slate-400 border-b-2 border-transparent'}`}>2. Autenticação e Assinatura</div>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">
          {step === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 animate-in fade-in slide-in-from-left-4">
              
              {/* --- COLUNA ESQUERDA: DADOS BASE --- */}
              <div className="lg:col-span-5 space-y-6 lg:border-r lg:border-slate-100 lg:pr-8">
                <div className="mb-2 hidden lg:block">
                  <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><User className="w-5 h-5 text-[#2563EB]"/> Favorecido</h2>
                  <p className="text-xs text-slate-400 font-medium mt-1">Quem irá receber os equipamentos.</p>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[#2563EB]" />
                      Data da Entrega
                    </h3>
                    <p className="text-[10px] font-medium text-slate-500 italic mt-0.5">Entregas retroativas.</p>
                  </div>
                  <input 
                    type="date"
                    title="Data da Entrega"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className="w-full sm:w-auto bg-white border border-slate-200 text-slate-900 rounded-xl px-4 py-3 sm:py-2 outline-none focus:border-[#2563EB] font-bold text-sm shadow-sm"
                  />
                </div>

                <div className="space-y-3">
                  <label htmlFor="employee-select" className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex justify-between">
                    <span>Colaborador Ativo</span>
                  </label>
                  <div className="flex flex-col gap-2 relative">
                    <input 
                      type="text"
                      placeholder="Busca por nome ou CPF..."
                      value={employeeSearchTerm}
                      onChange={(e) => setEmployeeSearchTerm(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-5 py-4 outline-none focus:border-[#2563EB] focus:bg-white transition-all font-bold text-sm"
                    />
                    
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                      <div className="max-h-[200px] overflow-y-auto divide-y divide-slate-50 custom-scrollbar">
                        {filteredEmployees.length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">Nenhum colaborador encontrado</div>
                        ) : (
                          filteredEmployees.map(emp => {
                            const isSelected = selectedEmployeeId === emp.id
                            return (
                              <div 
                                key={emp.id}
                                onClick={() => handleEmployeeChange(emp.id)}
                                className={`p-4 cursor-pointer transition-colors flex items-center justify-between ${isSelected ? 'bg-blue-50/70 border-l-4 border-[#2563EB]' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}
                              >
                                <div>
                                  <p className={`font-black text-sm uppercase tracking-tight ${isSelected ? 'text-[#2563EB]' : 'text-slate-700'}`}>
                                    {emp.full_name}
                                  </p>
                                  {emp.cpf && (
                                    <div className="flex items-center gap-2 mt-1.5">
                                      <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase tracking-widest">
                                        CPF: {formatCpf(emp.cpf)}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {isSelected && <CheckCircle2 className="w-5 h-5 text-[#2563EB]" />}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <span>Unidade / Local</span>
                    {selectedWorkplace && (
                      <span className="text-[9px] bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded font-black uppercase tracking-widest">
                        Auto-preenchido
                      </span>
                    )}
                  </label>
                  <select
                    title="Unidade / Local de Entrega"
                    value={selectedWorkplaceId}
                    onChange={(e) => setSelectedWorkplaceId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-5 py-4 outline-none focus:border-[#2563EB] focus:bg-white transition-all font-bold text-sm appearance-none cursor-pointer"
                  >
                    <option value="">- Nenhuma Unidade / Sede -</option>
                    {workplaces.map(wp => (
                      <option key={wp.id} value={wp.id}>{wp.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* --- COLUNA DIREITA: EPI E CARRINHO --- */}
              <div className="lg:col-span-7 space-y-6 flex flex-col h-full">
                <div className="mb-2 hidden lg:block">
                  <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><Package className="w-5 h-5 text-[#2563EB]"/> Equipamentos</h2>
                  <p className="text-xs text-slate-400 font-medium mt-1">Busque os EPIs e adicione ao carrinho.</p>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
                    {/* Busca EPI */}
                    <div className="space-y-2">
                      <input 
                        type="text"
                        placeholder="Busca por CA ou Nome..."
                        value={ppeSearchTerm}
                        onChange={(e) => setPpeSearchTerm(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-5 py-4 outline-none focus:border-[#2563EB] focus:bg-white transition-all font-bold text-sm"
                      />
                      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                        <div className="max-h-[220px] overflow-y-auto divide-y divide-slate-50 custom-scrollbar">
                          {filteredPpes.length === 0 ? (
                            <div className="p-6 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">Nenhum EPI encontrado</div>
                          ) : (
                            filteredPpes.map(ppe => {
                              const expired = new Date(ppe.ca_expiry_date).getTime() < new Date().setHours(0, 0, 0, 0)
                              const isSelected = currentPpeId === ppe.id
                              const inCart = cart.some(item => item.ppeId === ppe.id)
                              return (
                                <div 
                                  key={ppe.id}
                                  onClick={() => !inCart && setCurrentPpeId(ppe.id)}
                                  className={`p-4 cursor-pointer transition-colors flex items-center justify-between ${inCart ? 'opacity-40 cursor-not-allowed' : isSelected ? 'bg-blue-50/70 border-l-4 border-[#2563EB]' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}
                                >
                                  <div>
                                    <p className={`font-black text-xs uppercase tracking-tight ${isSelected ? 'text-[#2563EB]' : 'text-slate-700'}`}>{ppe.name}</p>
                                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                      <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded">CA {ppe.ca_number}</span>
                                      {expired && <span className="text-[8px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded">Vencido</span>}
                                      {inCart && <span className="text-[8px] font-black bg-green-100 text-green-600 px-2 py-0.5 rounded">Na lista</span>}
                                    </div>
                                  </div>
                                  {isSelected && !inCart && <CheckCircle2 className="w-4 h-4 text-[#2563EB]" />}
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Controles de Qtd e Motivo */}
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="quantity-input" className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Quantidade</label>
                          <input 
                            id="quantity-input" type="number" min="1" max="100" title="Quantidade do EPI"
                            className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl px-4 py-4 md:py-3 outline-none focus:border-[#2563EB] focus:bg-white transition-all font-bold text-sm text-center"
                            value={currentQuantity}
                            onChange={(e) => setCurrentQuantity(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                          />
                        </div>
                        <div>
                          <label htmlFor="reason-select" className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Motivo</label>
                          <select
                            id="reason-select" title="Motivo da entrega"
                            value={effectiveCurrentReason} onChange={(e) => setCurrentReason(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl px-3 py-4 md:py-3 outline-none focus:border-[#2563EB] font-bold text-[11px]"
                          >
                            <option value="Primeira Entrega">Prim. Entrega</option>
                            <option value={SUBSTITUTION_REASON}>Substituição</option>
                            <option value="Perda">Perda</option>
                            <option value="Dano">Dano</option>
                          </select>
                        </div>
                      </div>

                      {loadingActiveDeliveries && selectedEmployeeId && (
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center gap-3">
                          <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Consultando EPIs em posse...</p>
                        </div>
                      )}

                      {!loadingActiveDeliveries && currentPpe && currentActiveSamePpeDeliveries.length > 0 && (
                        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex items-start gap-3">
                          <div className="bg-amber-100 text-amber-700 rounded-lg p-2 flex-shrink-0">
                            <ShieldAlert className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest">Baixa automática na nova entrega</p>
                            <p className="text-xs text-amber-700 font-semibold mt-1 leading-relaxed">
                              {selectedEmployee?.full_name || "Colaborador"} possui {currentActiveSamePpeDeliveries.reduce((acc, delivery) => acc + getRemainingDeliveryQuantity(delivery), 0)} un. de {currentPpe.name}. Ao substituir {currentQuantity} un., a baixa será parcial e somente nessa quantidade.
                            </p>
                          </div>
                        </div>
                      )}

                      {currentPpe && currentPpe.lifespan_days > 0 && (
                        <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-black text-orange-600 uppercase tracking-widest">Vida Ãštil (NR-06)</span>
                            <span className="text-xs font-bold text-orange-800">{currentPpe.lifespan_days} dias</span>
                          </div>
                          <div className="flex items-center justify-between mt-1 pt-3 border-t border-orange-200/50">
                            <span className="text-[9px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Próxima Troca
                            </span>
                            <span className="text-xs font-black text-[#2563EB]">
                              {format(addDays(new Date(`${deliveryDate}T12:00:00`), currentPpe.lifespan_days), 'dd/MM/yyyy')}
                            </span>
                          </div>
                        </div>
                      )}
                      
                      <button 
                        onClick={addToCart}
                        disabled={!currentPpe || isCurrentPpeExpired}
                        className="w-full bg-slate-800 hover:bg-slate-900 text-white disabled:bg-slate-300 py-4 rounded-xl font-black uppercase tracking-widest text-[10px] sm:text-xs transition-all flex items-center justify-center gap-2 mt-2"
                      >
                        <Plus className="w-4 h-4" /> Adicionar Ã  Entrega
                      </button>
                    </div>
                  </div>
                </div>

                {/* Carrinho */}
                {cart.length > 0 && (
                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Package className="w-4 h-4" />
                      EPIs Adicionados ({cart.length})
                    </label>
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl divide-y divide-slate-200 overflow-hidden">
                      {cart.map((item) => (
                        <div key={item.ppeId} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <p className="font-black text-sm text-slate-800 uppercase tracking-tight">{item.ppeName}</p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <span className="text-[9px] font-bold bg-white text-slate-500 px-2 py-0.5 rounded border border-slate-200">CA {item.ppeCaNumber}</span>
                              <span className="text-[9px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Qtd: {item.quantity}</span>
                              <span className="text-[9px] font-bold text-slate-400">{item.reason}</span>
                              {item.autoReturnDeliveryIds && item.autoReturnDeliveryIds.length > 0 && (
                                <span className="text-[9px] font-black bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200">Baixa automática</span>
                              )}
                            </div>
                            {item.autoReturnNote && (
                              <p className="mt-2 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 inline-flex">
                                {item.autoReturnNote}
                              </p>
                            )}
                          </div>
                          <button 
                            onClick={() => removeFromCart(item.ppeId)} 
                            title="Remover EPI"
                            className="text-slate-300 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors self-end sm:self-auto"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex-1 hidden lg:block"></div>

                <div className="pt-6 space-y-3 lg:border-t lg:border-slate-100">
                  <button 
                    disabled={employees.length === 0 || cart.length === 0}
                    onClick={() => {
                      if (validateCartForDelivery()) setStep(2)
                    }}
                    className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white disabled:bg-slate-300 py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-xs transition-all shadow-xl shadow-blue-900/10 shadow-lg shadow-blue-900/15 flex items-center justify-center gap-2"
                  >
                    Avançar para Assinatura ({cart.length} EPI{cart.length !== 1 ? 's' : ''})
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="bg-slate-50 p-6 rounded-2xl text-sm border border-slate-200 shadow-inner">
                <div className="flex items-center gap-2 mb-3">
                    <span className="bg-[#2563EB] text-white text-[8px] font-black px-2 py-1 rounded uppercase tracking-widest">NR-06 Compliance</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">{selectedWorkplace?.name || "Sede"}</span>
                </div>
                <p className="font-medium text-slate-700 leading-relaxed text-sm">
                  &ldquo;Eu, <strong className="font-black text-slate-900 uppercase">{selectedEmployee?.full_name}</strong>, recebo nesta data os seguintes EPIs, declarando ter sido treinado para seu uso adequado:&rdquo;
                </p>
                <ul className="mt-4 space-y-2">
                  {cart.map(item => (
                    <li key={item.ppeId} className="text-xs text-slate-600 font-bold flex items-start gap-2 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                      <span className="w-1.5 h-1.5 bg-[#2563EB] rounded-full flex-shrink-0 mt-1.5" />
                      <span>
                        {item.ppeName} <span className="text-slate-400 font-medium">(CA {item.ppeCaNumber})</span> <br className="sm:hidden" /><span className="sm:ml-2 text-[#2563EB] bg-red-50 px-2 py-0.5 rounded text-[10px] tracking-widest">Qtd: {item.quantity}</span>
                        {item.autoReturnNote && (
                          <span className="block mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
                            {item.autoReturnNote}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 bg-slate-100 p-1.5 rounded-2xl">
                <button 
                  onClick={() => { setAuthMethod('manual'); setCapturedPhotoBase64(null) }}
                  className={`py-4 text-[10px] sm:text-xs font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 transition-all ${authMethod === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <PenLine className="w-4 h-4" /> Assinatura na Tela
                </button>
                <button 
                  onClick={() => { setAuthMethod('manual_facial'); setCapturedPhotoBase64(null) }}
                  className={`py-4 text-[10px] sm:text-xs font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 transition-all ${authMethod === 'manual_facial' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Camera className="w-4 h-4" /> Foto + Assinatura
                </button>
                <button 
                  onClick={() => { setAuthMethod('facial'); setCapturedPhotoBase64(null) }}
                  className={`py-4 text-[10px] sm:text-xs font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 transition-all ${authMethod === 'facial' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Fingerprint className="w-4 h-4" /> Biometria Facial
                </button>
              </div>

              {authMethod === 'manual' || authMethod === 'manual_facial' ? (
                <div className="space-y-4 animate-in fade-in">
                  {authMethod === 'manual_facial' && !capturedPhotoBase64 && (
                    !selectedEmployee?.face_descriptor ? (
                      <div className="bg-amber-50 border border-amber-200 p-8 rounded-3xl text-center space-y-4">
                        <div className="bg-amber-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                          <ShieldAlert className="w-8 h-8 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-amber-800 font-black uppercase tracking-tight text-lg">Biometria Indisponivel</p>
                          <p className="text-amber-600 text-sm mt-1 leading-relaxed">Cadastre a foto facial mestre do colaborador para usar Foto + Assinatura.</p>
                        </div>
                        <button onClick={() => setAuthMethod('manual')} className="mt-4 bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-colors">
                          Usar Assinatura Manual
                        </button>
                      </div>
                    ) : (
                      <FaceCamera
                        targetDescriptor={new Float32Array(selectedEmployee.face_descriptor)}
                        onCapture={(_, img) => setCapturedPhotoBase64(img)}
                        onCancel={() => { setAuthMethod('manual'); setCapturedPhotoBase64(null) }}
                      />
                    )
                  )}
                  {authMethod === 'manual_facial' && capturedPhotoBase64 && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
                      <Image src={capturedPhotoBase64} alt="Foto capturada agora" width={44} height={44} className="w-11 h-11 rounded-xl object-cover border border-emerald-200" unoptimized />
                      <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest leading-relaxed">
                        Identidade verificada. O PDF vai sair com a foto capturada agora e a assinatura manual abaixo.
                      </p>
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
                  <div className="flex justify-between items-end px-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Área de Assinatura</label>
                    <button onClick={clearSignature} className="text-[10px] font-black text-[#2563EB] uppercase hover:underline italic bg-red-50 px-3 py-1 rounded-lg">Limpar Traço</button>
                  </div>
                  <div className="bg-white rounded-3xl overflow-hidden border-2 border-slate-200 shadow-inner h-64 touch-none cursor-crosshair">
                    <SignatureCanvas 
                      ref={sigCanvas}
                      canvasProps={{ className: 'w-full h-full' }}
                      penColor="#000000"
                    />
                  </div>
                  <button 
                    disabled={isSaving}
                    onClick={handleManualSave}
                    className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-xs transition-all shadow-xl shadow-blue-900/20 flex items-center justify-center shadow-lg shadow-blue-900/15 disabled:opacity-50 mt-4"
                  >
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : `CONFIRMAR ENTREGA (${cart.length} EPI${cart.length !== 1 ? 'S' : ''})`}
                  </button>
                  <button
                    onClick={generateRemoteLink}
                    disabled={cart.length === 0 || isSaving}
                    className="w-full bg-white border border-slate-200 text-slate-600 py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-slate-50 transition-all disabled:opacity-40"
                  >
                    <Link2 className="w-4 h-4 text-blue-500" /> Enviar link para assinatura
                  </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-4 animate-in zoom-in-95">
                  {!selectedEmployee?.face_descriptor ? (
                    <div className="bg-amber-50 border border-amber-200 p-8 rounded-3xl text-center space-y-4">
                      <div className="bg-amber-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                        <ShieldAlert className="w-8 h-8 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-amber-800 font-black uppercase tracking-tight text-lg">Biometria Indisponível</p>
                        <p className="text-amber-600 text-sm mt-1 leading-relaxed">O colaborador <strong className="uppercase">{selectedEmployee?.full_name}</strong> ainda não realizou o registro facial mestre.</p>
                      </div>
                      <button onClick={() => setAuthMethod('manual')} className="mt-4 bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-colors">
                        Usar Assinatura Manual
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Identidade Requerida</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-slate-700 uppercase">{selectedEmployee.full_name}</span>
                          <Image src={selectedEmployee.photo_url || ''} alt="User" width={32} height={32} className="w-8 h-8 rounded-full border-2 border-white shadow-sm object-cover" unoptimized />
                        </div>
                      </div>
                      <FaceCamera 
                        targetDescriptor={new Float32Array(selectedEmployee.face_descriptor)}
                        onCapture={handleFaceCapture}
                        onCancel={() => setAuthMethod('manual')}
                      />
                      <button
                        onClick={generateRemoteLink}
                        disabled={cart.length === 0 || isSaving}
                        className="w-full bg-white border border-slate-200 text-slate-600 py-4 rounded-2xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-slate-50 transition-all disabled:opacity-40"
                      >
                        <Link2 className="w-4 h-4 text-blue-500" /> Enviar link para assinatura
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="pt-6 flex justify-center border-t border-slate-100">
                <button onClick={() => setStep(1)} className="text-slate-400 font-black text-[10px] uppercase tracking-[0.2em] hover:text-slate-800 transition-colors bg-slate-50 px-6 py-3 rounded-xl">
                  â† Voltar e Alterar EPIs
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
