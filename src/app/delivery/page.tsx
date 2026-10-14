"use client"

// ui: câmera/assinatura redesenhada — mobile-first ✓

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import Image from "next/image"
import SignatureCanvas from "react-signature-canvas"
import { Camera, CheckCircle2, ExternalLink, FileDown, Loader2, ShieldAlert, Fingerprint, PenLine, Link2, Plus, Trash2, Package, Calendar, Clock, User, Clipboard, RefreshCw, Hourglass, XCircle, Search } from "lucide-react"
import { format, addDays } from "date-fns"
import { api, type PendingDeliveryRemoteLink, type FingerprintEvidence } from "@/services/api"
import { Employee, PPE, Workplace, Delivery, DeliveryWithRelations } from "@/types/database"
import { useAuth } from "@/contexts/AuthContext"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { FacialDeliveryConfirmation, type FacialSubmission } from "@/components/ui/FacialDeliveryConfirmation"
import { submitFacialDelivery } from "@/components/ui/submitFacialDelivery"
import { FacialPreflightError } from "@/components/ui/facialClient"
import { SignatureCapture } from "@/components/ui/SignatureCapture"
import { FingerprintCommandPanel } from "@/components/biometrics/FingerprintCommandPanel"
import { LoadingState } from "@/components/ui/LoadingState"
import { DataLoadError } from "@/components/ui/DataLoadError"
import type { BiometricReceiptMetadata } from "@/utils/pdfGenerator"
import { COMPANY_CONFIG } from "@/config/company"
import { formatCpf } from "@/utils/cpf"
import { generateAuditCode } from "@/utils/auditCode"
import { copyTextToClipboard } from "@/utils/clipboard"
import { getSignatureDataUrl } from "@/utils/signatureCanvas"
import { getDateOnlyValue, isDateOnlyPast, toLocalDeliveryDateISOString } from "@/lib/dateOnly"
import { toast } from "@/lib/toast"
import { isValidGeoLocation, requestRequiredGeolocation } from "@/utils/geolocation"
import { fetchImageDataUrl, imageDataUrlToFile } from "@/utils/imageDataUrl"
import { createDeliveryOperation, deliveryOperationStorageKey, readDeliveryOperation, runDeliveryOperation, type DeliveryOperation } from "@/lib/deliveryOperation"

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
type PendingCheckResult = "completed" | "expired" | "pending" | "error"

type PendingDeliveryDraft = {
  key: string
  token: string
  linkUrl: string
  status: RemoteLinkStatus
  expiresAt: string | null
  companyId?: string | null
  employeeId: string
  employeeName: string
  workplaceId: string
  workplaceName: string
  deliveryDate: string
  item: CartItem
  items?: CartItem[]
  deliveryIds?: string[]
  signaturePendingOnly?: boolean
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

const normalizeSearchText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

const dataUrlToImageFile = (dataUrl: string, baseName: string) => imageDataUrlToFile(dataUrl, baseName)

export default function DeliveryPage() {
  const { user } = useAuth()
  const [step, setStep] = useState(1)
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  
  const [isSaved, setIsSaved] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [lastPdfFileName, setLastPdfFileName] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)
  const operationRef = useRef<DeliveryOperation | null>(null)
  const [operation, setOperation] = useState<DeliveryOperation | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [remoteOptionsOpen, setRemoteOptionsOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"new" | "pending">("new")
  const [pendingDrafts, setPendingDrafts] = useState<PendingDeliveryDraft[]>([])
  const [pendingSearchTerm, setPendingSearchTerm] = useState("")
  const [remoteWaitHours, setRemoteWaitHours] = useState(24)
  const [checkingPendingToken, setCheckingPendingToken] = useState<string | null>(null)
  const [reopeningPendingToken, setReopeningPendingToken] = useState<string | null>(null)

  const [ipAddress, setIpAddress] = useState<string>("")
  const [location, setLocation] = useState<string>("")
  const [locationStatus, setLocationStatus] = useState<"idle" | "requesting" | "granted" | "blocked">("idle")
  const [locationError, setLocationError] = useState("")
  const locationSourceRef = useRef<"device" | "network">("device")
  const [locationSource, setLocationSource] = useState<"device" | "network">("device")

  const [employees, setEmployees] = useState<Employee[]>([])
  const [ppes, setPpes] = useState<PPE[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [activeDeliveries, setActiveDeliveries] = useState<DeliveryWithRelations[]>([])
  const [loadingActiveDeliveries, setLoadingActiveDeliveries] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [optionsReload, setOptionsReload] = useState(0)

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("")
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState("")
  const [ppeSearchTerm, setPpeSearchTerm] = useState("")
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState("")
  const [deliveryDate, setDeliveryDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
  // Keep the challenge context stable across renders and request retries.
  const facialDeliveryDateIso = useMemo(() => toLocalDeliveryDateISOString(deliveryDate), [deliveryDate])

  const [cart, setCart] = useState<CartItem[]>([])
  const [currentPpeId, setCurrentPpeId] = useState("")
  const [currentQuantity, setCurrentQuantity] = useState(1)
  const [currentReason, setCurrentReason] = useState("Primeira Entrega")

  const [authMethod, setAuthMethod] = useState<'manual' | 'facial' | 'manual_facial' | 'fingerprint'>('manual')
  const [fingerprintEvidence, setFingerprintEvidence] = useState<FingerprintEvidence | null>(null)
  const [capturedPhotoBase64, setCapturedPhotoBase64] = useState<string | null>(null)
  const [facialTransactionLocked, setFacialTransactionLocked] = useState(false)
  const companyId = user?.role === "MASTER" ? api.getMasterCompanyContext() || user.company_id : user?.company_id
  const operationStorageKey = user?.id && companyId ? deliveryOperationStorageKey(user.id, companyId) : null
  const persistOperation = useCallback((next: DeliveryOperation) => {
    if (!operationStorageKey) throw new Error("Confirme a empresa antes de registrar a entrega.")
    window.sessionStorage.setItem(operationStorageKey, JSON.stringify(next))
    operationRef.current = next
    setOperation(structuredClone(next))
  }, [operationStorageKey])
  const clearOperation = () => {
    if (operationStorageKey) window.sessionStorage.removeItem(operationStorageKey)
    operationRef.current = null
    setOperation(null)
    setOperationError(null)
  }

  const requestLocationForSignature = useCallback(async (showToast = true) => {
    if (isValidGeoLocation(location)) {
      setLocationStatus("granted")
      setLocationError("")
      return location
    }

    setLocationStatus("requesting")
    const result = await requestRequiredGeolocation()

    if (result.ok) {
      locationSourceRef.current = result.source
      setLocationSource(result.source)
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

  const pendingSignatureSummary = useMemo(() => {
    const pending = pendingDrafts.filter((draft) => draft.status === "pending").length
    const expired = pendingDrafts.filter((draft) => draft.status === "expired").length
    return {
      total: pendingDrafts.length,
      pending,
      expired,
    }
  }, [pendingDrafts])

  useEffect(() => {
    const captureMetadata = async () => {
        try {
            setLocationStatus("requesting")
            const locationResult = await requestRequiredGeolocation()
            if (locationResult.ok) {
              locationSourceRef.current = locationResult.source
              setLocationSource(locationResult.source)
              setLocation(locationResult.value)
              setLocationStatus("granted")
              setLocationError("")
            } else {
              setLocation("")
              setLocationStatus("blocked")
              setLocationError(locationResult.message)
            }
        } catch (e) { console.error("Erro ao capturar metadados:", e) }
    }
    void fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (typeof data?.ip === "string") setIpAddress(data.ip) })
      .catch(() => { /* optional IP lookup must not block location or navigation */ })
    captureMetadata()

    async function loadOptions() {
      try {
        setLoadingOptions(true)
        setOptionsError(null)
        const [empData, ppeData, wpData] = await Promise.all([
          api.getEmployees({ signPhotos: false }),
          api.getPpes(),
          api.getWorkplaces()
        ])
        setEmployees(empData.filter(e => e.active))
        setPpes(ppeData.filter(p => p.active))
        setWorkplaces(wpData)
        
        const recovering = operationStorageKey ? readDeliveryOperation(window.sessionStorage, operationStorageKey) : null
        if (recovering) {
          operationRef.current = recovering
          setOperation(recovering)
          setSelectedEmployeeId(recovering.employeeId)
          setSelectedWorkplaceId(recovering.workplaceId)
          setDeliveryDate(format(new Date(recovering.deliveryDate), "yyyy-MM-dd"))
          setAuthMethod(recovering.authMethod)
          setCart(recovering.items.map((entry) => {
            const ppe = ppeData.find((candidate) => candidate.id === entry.ppeId)
            return { ppeId: entry.ppeId, ppeName: ppe?.name || "EPI do pedido", ppeCaNumber: ppe?.ca_number || "", ppeCaExpiry: ppe?.ca_expiry_date || "", quantity: entry.quantity, reason: entry.reason,
              autoReturnAllocations: entry.returns.map((allocation) => ({ deliveryId: allocation.deliveryId, quantity: allocation.quantity, deliveryDate: "" })),
            }
          }))
          setStep(2)
        } else if (empData.length > 0) {
            setSelectedEmployeeId(empData[0].id)
            setSelectedWorkplaceId(empData[0].workplace_id || "")
        }
        if (ppeData.length > 0) setCurrentPpeId(ppeData[0].id)
      } catch (error) {
        console.error("Erro ao carregar opções:", error)
        setOptionsError(error instanceof Error ? error.message : "Não foi possível consultar os cadastros.")
      } finally {
        setLoadingOptions(false)
      }
    }

    loadOptions()
  }, [optionsReload, operationStorageKey])

  useEffect(() => {
    return () => {
      if (lastPdfUrl) {
        window.URL.revokeObjectURL(lastPdfUrl)
      }
    }
  }, [lastPdfUrl])

  useEffect(() => {
    let cancelled = false
    if (!selectedEmployeeId) {
      const timer = window.setTimeout(() => setActiveDeliveries([]), 0)
      return () => window.clearTimeout(timer)
    }

    const timer = window.setTimeout(() => {
      const loadEmployeeActiveDeliveries = async () => {
        try {
          setLoadingActiveDeliveries(true)
          const history = await api.getEmployeeHistory(selectedEmployeeId)
          if (!cancelled) setActiveDeliveries(history.filter(delivery => !delivery.returned_at && getRemainingDeliveryQuantity(delivery) > 0))
        } catch (err) {
          console.error("Erro ao carregar EPIs ativos do colaborador:", err)
          if (!cancelled) setActiveDeliveries([])
        } finally {
          if (!cancelled) setLoadingActiveDeliveries(false)
        }
      }

      void loadEmployeeActiveDeliveries()
    }, 0)

    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [selectedEmployeeId])

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId)
  const currentPpe = ppes.find(p => p.id === currentPpeId)
  const selectedWorkplace = workplaces.find(w => w.id === selectedWorkplaceId)
  const selectedThirdPartyId = selectedEmployee?.third_party_id || selectedWorkplace?.third_party_id || null
  const currentActiveSamePpeDeliveries = activeDeliveries.filter(delivery => delivery.ppe_id === currentPpeId && !delivery.returned_at)

  const shouldAutoReturn = (reason: string, deliveries = currentActiveSamePpeDeliveries) =>
    deliveries.length > 0 && reason !== "Primeira Entrega"

  const formatRemoteExpiry = (value: string | null) => {
    if (!value) return "sem prazo"
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const readLocalPendingDrafts = useCallback(() => {
    const drafts: PendingDeliveryDraft[] = []

    if (typeof window === "undefined") return drafts

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

    return drafts
  }, [])

  const getStringFromData = useCallback((data: Record<string, unknown> | null | undefined, key: string) => {
    const value = data?.[key]
    return typeof value === "string" ? value : ""
  }, [])

  const getStringArrayFromData = useCallback((data: Record<string, unknown> | null | undefined, key: string) => {
    const value = data?.[key]
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  }, [])

  const toCartItemFromRemote = useCallback((value: unknown, fallbackData?: Record<string, unknown> | null): CartItem | null => {
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
    const ppeId = typeof source.ppeId === "string"
      ? source.ppeId
      : getStringFromData(fallbackData, "p")
    const ppeName = typeof source.ppeName === "string" && source.ppeName.trim()
      ? source.ppeName
      : "EPI pendente"
    const ppeCaNumber = typeof source.ppeCaNumber === "string"
      ? source.ppeCaNumber
      : "N/A"
    const ppeCaExpiry = typeof source.ppeCaExpiry === "string"
      ? source.ppeCaExpiry
      : ""
    const quantityRaw = typeof source.quantity === "number" ? source.quantity : Number(fallbackData?.q || 1)
    const reason = typeof source.reason === "string"
      ? source.reason
      : getStringFromData(fallbackData, "r") || "Primeira Entrega"

    if (!ppeId) return null

    return {
      ppeId,
      ppeName,
      ppeCaNumber,
      ppeCaExpiry,
      quantity: Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1,
      reason,
      autoReturnDeliveryIds: Array.isArray(source.autoReturnDeliveryIds)
        ? source.autoReturnDeliveryIds.filter((id): id is string => typeof id === "string")
        : getStringArrayFromData(fallbackData, "autoReturnedDeliveryIds"),
      autoReturnNote: typeof source.autoReturnNote === "string" ? source.autoReturnNote : undefined,
    }
  }, [getStringArrayFromData, getStringFromData])

  const buildDraftFromRemoteLink = useCallback((link: PendingDeliveryRemoteLink, localDraft?: PendingDeliveryDraft): PendingDeliveryDraft | null => {
    const data = link.data || {}
    const rawItems = Array.isArray(data.items) ? data.items : []
    const items = rawItems
      .map((item) => toCartItemFromRemote(item, data))
      .filter((item): item is CartItem => Boolean(item))
    const item = items[0] || toCartItemFromRemote({}, data) || localDraft?.item

    if (!link.token || !item) return null

    const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
    const key = `delivery-signature:${link.token}`

    return {
      key,
      token: link.token,
      linkUrl: localDraft?.linkUrl || `${baseUrl}/delivery/remote?t=${link.token}`,
      status: link.status || "pending",
      expiresAt: link.expires_at || localDraft?.expiresAt || null,
      companyId: link.company_id || localDraft?.companyId || null,
      employeeId: getStringFromData(data, "e") || link.employee_id || localDraft?.employeeId || "",
      employeeName: localDraft?.employeeName || getStringFromData(data, "employeeName") || link.employee?.full_name || "Colaborador",
      workplaceId: getStringFromData(data, "w") || localDraft?.workplaceId || "",
      workplaceName: localDraft?.workplaceName || getStringFromData(data, "workplaceName") || "Sede",
      deliveryDate: getStringFromData(data, "deliveryDate") || localDraft?.deliveryDate || format(new Date(), "yyyy-MM-dd"),
      item,
      items: items.length > 0 ? items : localDraft?.items,
      deliveryIds: getStringArrayFromData(data, "deliveryIds").length > 0
        ? getStringArrayFromData(data, "deliveryIds")
        : localDraft?.deliveryIds,
      signaturePendingOnly: data.signaturePendingOnly === true || localDraft?.signaturePendingOnly === true,
    }
  }, [getStringArrayFromData, getStringFromData, toCartItemFromRemote])

  const loadPendingDrafts = useCallback(async () => {
    if (typeof window === "undefined") return

    const currentCompanyId = api.getMasterCompanyContext()
    const localDrafts = readLocalPendingDrafts().filter((draft) =>
      !currentCompanyId || draft.companyId === currentCompanyId
    )
    const byToken = new Map(localDrafts.map((draft) => [draft.token, draft]))
    setPendingDrafts(localDrafts.sort((a, b) => (b.expiresAt || "").localeCompare(a.expiresAt || "")))

    try {
      const links = await api.getPendingDeliverySignatureLinks()
      for (const link of links) {
        const remoteDraft = buildDraftFromRemoteLink(link, byToken.get(link.token))
        if (!remoteDraft) continue
        byToken.set(remoteDraft.token, remoteDraft)
        window.localStorage.setItem(remoteDraft.key, JSON.stringify(remoteDraft))
      }
    } catch {
      // remote sync is best-effort; local drafts are still valid
    }

    setPendingDrafts(
      Array.from(byToken.values()).sort((a, b) => (b.expiresAt || "").localeCompare(a.expiresAt || ""))
    )
  }, [buildDraftFromRemoteLink, readLocalPendingDrafts])

  const persistPendingDraft = useCallback((draft: Omit<PendingDeliveryDraft, "key">) => {
    if (typeof window === "undefined") return
    const key = `delivery-signature:${draft.token}`
    window.localStorage.setItem(key, JSON.stringify({ ...draft, key }))
    void loadPendingDrafts()
  }, [loadPendingDrafts])

  const updatePendingDraft = useCallback((token: string, updates: Partial<PendingDeliveryDraft>) => {
    if (typeof window === "undefined") return
    const key = `delivery-signature:${token}`
    const current = window.localStorage.getItem(key)
    if (!current) return

    try {
      const parsed = JSON.parse(current) as PendingDeliveryDraft
      window.localStorage.setItem(key, JSON.stringify({ ...parsed, ...updates, key }))
      void loadPendingDrafts()
    } catch {
      window.localStorage.removeItem(key)
      void loadPendingDrafts()
    }
  }, [loadPendingDrafts])

  const removePendingDraft = useCallback((token: string) => {
    if (typeof window === "undefined") return
    window.localStorage.removeItem(`delivery-signature:${token}`)
    void loadPendingDrafts()
  }, [loadPendingDrafts])

  const isCurrentPpeExpired = currentPpe ? isDateOnlyPast(currentPpe.ca_expiry_date) : false

  const filteredPpes = ppes.filter(ppe => 
    ppe.name.toLowerCase().includes(ppeSearchTerm.toLowerCase()) || 
    ppe.ca_number.includes(ppeSearchTerm)
  )

  const filteredEmployees = employees.filter(emp => 
    emp.full_name.toLowerCase().includes(employeeSearchTerm.toLowerCase()) || 
    (emp.cpf && emp.cpf.includes(employeeSearchTerm))
  )

  const filteredPendingDrafts = useMemo(() => {
    const query = normalizeSearchText(pendingSearchTerm.trim())
    if (!query) return pendingDrafts

    return pendingDrafts.filter((draft) => {
      const draftItems = draft.items && draft.items.length > 0 ? draft.items : [draft.item]
      const searchableText = [
        draft.employeeName,
        draft.workplaceName,
        draft.deliveryDate,
        draft.status,
        draft.token,
        ...draftItems.flatMap((item) => [
          item.ppeName,
          item.ppeCaNumber,
          item.reason,
          item.quantity,
          item.autoReturnNote,
        ]),
      ].join(" ")

      return normalizeSearchText(searchableText).includes(query)
    })
  }, [pendingDrafts, pendingSearchTerm])

  const handleEmployeeChange = (empId: string) => {
    if (operationRef.current) return
    setActiveDeliveries([])
    setCart([])
    setFingerprintEvidence(null)
    setSelectedEmployeeId(empId)
    setCapturedPhotoBase64(null)
    const emp = employees.find(e => e.id === empId)
    if (emp && emp.workplace_id) {
        setSelectedWorkplaceId(emp.workplace_id)
    } else {
        setSelectedWorkplaceId("")
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPendingDrafts()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadPendingDrafts])

  const pendingDraftsRef = useRef<PendingDeliveryDraft[]>([])
  useEffect(() => {
    pendingDraftsRef.current = pendingDrafts
  }, [pendingDrafts])

  const addToCart = () => {
    if (operationRef.current) return
    if (!currentPpe) return
    if (!Number.isInteger(currentQuantity) || currentQuantity < 1 || currentQuantity > 1000) {
      toast.error("Informe uma quantidade inteira entre 1 e 1.000.")
      return
    }
    if (isCurrentPpeExpired) {
      toast.error("EPI com CA vencido não pode ser entregue.")
      return
    }
    
    const totalInCart = cart.reduce((acc, item) => item.ppeId === currentPpeId ? acc + item.quantity : acc, 0)
    if (totalInCart + currentQuantity > currentPpe.current_stock) {
      toast.error(`Estoque Insuficiente! Você possui apenas ${currentPpe.current_stock} unidades de ${currentPpe.name} no estoque. Por favor, adicione mais estoque primeiro.`)
      return
    }

    if (cart.some(item => item.ppeId === currentPpeId)) {
      toast.error("Este EPI já está na lista. Remova-o se quiser alterar a quantidade.")
      return
    }

    const selectedReason = currentReason
    const autoReturnAllocations: { deliveryId: string; quantity: number; deliveryDate: string }[] = []
    if (shouldAutoReturn(selectedReason)) {
      let pendingReturnQuantity = currentQuantity
      for (const delivery of currentActiveSamePpeDeliveries) {
        if (pendingReturnQuantity <= 0) break
        const available = getRemainingDeliveryQuantity(delivery)
        if (available <= 0) continue
        const quantityToReturn = Math.min(available, pendingReturnQuantity)
        autoReturnAllocations.push({ deliveryId: delivery.id, quantity: quantityToReturn, deliveryDate: delivery.delivery_date })
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
      : `${currentPpe.name} adicionado à entrega.`
    )
  }

  const removeFromCart = (ppeId: string) => {
    if (operationRef.current) return
    setCart(prev => prev.filter(item => item.ppeId !== ppeId))
  }

  const validateCartForDelivery = useCallback(() => {
    if (operationRef.current) return true // Resume the frozen intention, not today's already-decreased stock.
    if (!selectedEmployee?.active || cart.length === 0 || !Number.isFinite(Date.parse(facialDeliveryDateIso))) {
      toast.error("Confira colaborador, data e itens antes de confirmar.")
      return false
    }
    for (const item of cart) {
      const ppe = ppes.find((candidate) => candidate.id === item.ppeId)
      if (!ppe?.active || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
        toast.error(`EPI ${item.ppeName} nao encontrado no catalogo.`)
        return false
      }

      const caExpired = isDateOnlyPast(ppe.ca_expiry_date)
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
  }, [cart, ppes, selectedEmployee, facialDeliveryDateIso])

  const getOperation = (mode: "signed" | "later", fingerprintEventId?: string) => {
    const current = operationRef.current
    if (current) {
      if (current.mode !== mode) throw new Error("Retome a mesma modalidade do pedido iniciado.")
      return current
    }
    const next = createDeliveryOperation({
      employeeId: selectedEmployeeId, workplaceId: selectedWorkplaceId, thirdPartyId: selectedThirdPartyId,
      deliveryDate: facialDeliveryDateIso, mode, authMethod: mode === "later" ? "manual" : authMethod as "manual" | "manual_facial" | "fingerprint",
      fingerprintEventId: fingerprintEventId || null,
      items: cart.map((entry) => ({ ppeId: entry.ppeId, quantity: entry.quantity, reason: entry.reason,
        returns: (entry.autoReturnAllocations || []).map((allocation) => {
          const previous = activeDeliveries.find((delivery) => delivery.id === allocation.deliveryId)
          if (!previous || previous.employee_id !== selectedEmployeeId || previous.ppe_id !== entry.ppeId) throw new Error("O historico de substituicao mudou. Atualize os itens antes de confirmar.")
          return { deliveryId: allocation.deliveryId, quantity: allocation.quantity, baseline: previous.returned_quantity || 0 }
        }),
      })),
    })
    persistOperation(next)
    return next
  }

  const runOperation = async (current: DeliveryOperation, signatureFile?: File) => {
    let history: DeliveryWithRelations[] | null = null
    const getHistory = async () => history ??= await api.getEmployeeHistory(current.employeeId, { signAssets: false })
    let operationSignature = signatureFile
    const restoreOriginalSignature = async (delivery: Delivery | undefined) => {
      if (delivery?.signature_url && current.mode === "signed" && current.authMethod !== "fingerprint") {
        const url = await api.getPrivateAssetUrl(delivery.signature_url)
        const image = await fetchImageDataUrl(url, { required: true, label: "assinatura original do pedido" })
        if (!image) throw new Error("A assinatura original nao esta disponivel. Retome mais tarde; a entrega ja registrada sera preservada.")
        operationSignature = await dataUrlToImageFile(image, "signature")
      }
      return delivery
    }
    return runDeliveryOperation<Delivery>(current, {
      persist: persistOperation,
      create: async (entry, index) => {
        const result = await api.saveDelivery({ employee_id: current.employeeId, third_party_id: current.thirdPartyId,
        ppe_id: entry.ppeId, workplace_id: current.workplaceId || null, reason: entry.reason as Delivery["reason"], quantity: entry.quantity,
        ip_address: ipAddress || "Desconhecido", auth_method: current.authMethod, signature_url: null, delivery_date: current.deliveryDate,
        }, operationSignature, current.fingerprintEventId ? { fingerprintEventId: current.fingerprintEventId, fingerprintBatchId: current.id } : undefined, { idempotencyKey: entry.key })
        if (index === 0) await restoreOriginalSignature(result)
        return result
      },
      read: async (id) => restoreOriginalSignature((await getHistory()).find((entry) => entry.id === id)),
      returnedQuantity: async (id) => {
        history = null
        const entry = (await getHistory()).find((entry) => entry.id === id)
        if (!entry) throw new Error("Nao foi possivel conferir a baixa anterior. Consulte o historico.")
        return entry.returned_quantity || 0
      },
      returnItem: (allocation, entry) => api.returnDeliveryQuantity(allocation.deliveryId, getAutoReturnMotive(entry.reason), allocation.quantity,
        { restock: false, employeeId: current.employeeId, expectedReturnedQuantity: allocation.baseline }),
    })
  }

  const clearSignature = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear()
    }
  }

  const saveDelivery = async (signatureDataUrl?: string, facialSubmission?: FacialSubmission, verifiedFingerprint?: FingerprintEvidence) => {
    if (savingRef.current) return
    if (cart.length === 0) {
      toast.error("Adicione pelo menos um EPI à lista de entrega.")
      if (facialSubmission) throw new FacialPreflightError("Adicione os EPIs antes de confirmar.")
      return
    }
    if (!validateCartForDelivery()) { if (facialSubmission) throw new FacialPreflightError("Confira os itens e o estoque antes de confirmar."); return }
    if (authMethod === 'facial' && !facialSubmission) throw new Error("Verifique o rosto e confirme os itens antes de finalizar.")
    savingRef.current = true
    try {
      setIsSaving(true)
      setOperationError(null)
      const requiredLocation = await requestLocationForSignature()
      if (!requiredLocation) { if (facialSubmission) throw new FacialPreflightError("Autorize a localização antes de confirmar o recebimento."); return }
      
      const validationHash = generateAuditCode()
      
      const biometricEvidence = authMethod === 'fingerprint'
        ? operationRef.current?.fingerprintEventId ? await api.getFingerprintCommand(operationRef.current.fingerprintEventId) : verifiedFingerprint || fingerprintEvidence
        : null
      if (authMethod === 'fingerprint' && !operationRef.current?.fingerprintEventId && (!biometricEvidence || biometricEvidence.status !== 'completed' || biometricEvidence.operation !== 'verify' || biometricEvidence.employeeId !== selectedEmployeeId || biometricEvidence.matchedEmployeeId !== selectedEmployeeId)) {
        throw new Error("Confirme a digital do colaborador antes de concluir a entrega.")
      }
      const signatureFile = facialSubmission || !signatureDataUrl ? undefined : await dataUrlToImageFile(signatureDataUrl, "signature")
      const photoBase64 = authMethod === 'manual_facial' ? capturedPhotoBase64 || undefined : undefined
      const currentOperation = facialSubmission ? null : getOperation("signed", biometricEvidence?.id)
      const fingerprintBatchId = currentOperation?.fingerprintEventId ? currentOperation.id : null
      const selectedDeliveryDateIso = currentOperation?.deliveryDate || facialDeliveryDateIso

      const savedDeliveries: Delivery[] = []
      const autoReturnedDeliveryIds: string[] = []
      let biometricReceipt: BiometricReceiptMetadata | undefined

      if (facialSubmission) {
        const result = await submitFacialDelivery(facialSubmission)
        savedDeliveries.push(...result.deliveries)
        biometricReceipt = result.receipt
      } else if (currentOperation) {
        savedDeliveries.push(...await runOperation(currentOperation, signatureFile))
        autoReturnedDeliveryIds.push(...currentOperation.items.flatMap((entry) => entry.returns.filter((allocation) => allocation.state === "done").map((allocation) => allocation.deliveryId)))
      }

      const originalSignature = !facialSubmission && savedDeliveries[0]?.signature_url
        ? await fetchImageDataUrl(await api.getPrivateAssetUrl(savedDeliveries[0].signature_url), { required: true, label: "assinatura registrada" })
        : signatureDataUrl
      const { generateDeliveryPDF } = await import("@/utils/pdfGenerator")
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
          autoReturnNote: facialSubmission ? undefined : item.autoReturnNote
        })),
        authMethod,
        biometricReceipt,
        fingerprintEvidence: biometricEvidence ? { code: biometricEvidence.code, terminalName: biometricEvidence.terminalName || "Terminal SafeEPI", completedAt: biometricEvidence.completedAt || "", resultHash: biometricEvidence.resultHash || "" } : undefined,
        signatureBase64: originalSignature || undefined,
        photoBase64,
        ipAddress,
        location: requiredLocation,
        locationSource: locationSourceRef.current,
        validationHash,
        deliveryDate: facialSubmission ? savedDeliveries[0]?.delivery_date || facialDeliveryDateIso : selectedDeliveryDateIso
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
          geoLocation: requiredLocation,
          metadata: {
            biometricReceipt,
            locationSource: locationSourceRef.current,
            fingerprintEvidence: biometricEvidence ? { id: biometricEvidence.id, code: biometricEvidence.code, terminalName: biometricEvidence.terminalName, completedAt: biometricEvidence.completedAt, resultHash: biometricEvidence.resultHash, batchId: fingerprintBatchId } : null,
            validationHash,
            workplaceName: selectedWorkplace?.name || "Sede",
            thirdPartyId: selectedThirdPartyId,
            itemCount: cart.length,
            items: cart.map((item) => ({
              ppeId: item.ppeId,
              ppeName: item.ppeName,
              caNumber: item.ppeCaNumber,
              quantity: item.quantity,
              reason: item.reason,
              autoReturnDeliveryIds: facialSubmission ? [] : item.autoReturnDeliveryIds || [],
              autoReturnNote: facialSubmission ? undefined : item.autoReturnNote,
            })),
            autoReturnedDeliveryIds,
          },
        })
      } catch (archiveError) {
        const message = archiveError instanceof Error ? archiveError.message : "Nao foi possivel arquivar o PDF assinado."
        const lowerMessage = message.toLowerCase()
        const payloadTooLarge = lowerMessage.includes("function_payload_too_large")
          || lowerMessage.includes("request entity too large")
          || lowerMessage.includes("payload too large")

        if (payloadTooLarge) {
          toast.info("Entrega salva. O PDF ficou disponivel para baixar, mas o arquivo juridico excedeu o limite automatico.")
        } else {
          toast.warning(message)
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
      setIsSaved(true)
      clearOperation()
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
      setOperationError(message)
      toast.error(message)
      if (facialSubmission) throw err
    } finally {
      setIsSaving(false)
      savingRef.current = false
    }
  }

  const handleManualSave = () => {
    if (authMethod === 'manual_facial' && !capturedPhotoBase64) {
      toast.error("Capture a foto de evidência antes de confirmar a assinatura manual.")
      return
    }
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      toast.error("A assinatura é obrigatória.")
      return
    }
    const signatureDataUrl = getSignatureDataUrl(sigCanvas.current)
    if (!signatureDataUrl) {
      toast.error("Nao foi possivel ler a assinatura. Limpe e assine novamente.")
      return
    }
    saveDelivery(signatureDataUrl)
  }

  const generateRemoteLink = async () => {
      if (operationRef.current) { toast.warning("Retome o pedido em andamento antes de gerar outro link."); return }
      if (facialTransactionLocked) { toast.warning("Conclua ou consulte a confirmação facial em andamento antes de gerar outro link."); return }
      if (cart.length === 0) {
        toast.error("Adicione pelo menos um EPI à lista antes de gerar o link.")
	        return
	      }
      if (cart.length > 1) {
        toast.error("Assinatura remota aceita 1 EPI por link. Gere um link separado para cada entrega.")
        return
      }
      if (!validateCartForDelivery()) return
	      const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
      const selectedDeliveryDateIso = toLocalDeliveryDateISOString(deliveryDate)
      const deliveryDataPayload = {
          e: selectedEmployeeId,
          p: cart[0].ppeId,
          w: selectedWorkplaceId,
          thirdPartyId: selectedThirdPartyId,
          q: cart[0].quantity,
          r: cart[0].reason,
          deliveryDate: selectedDeliveryDateIso,
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
          companyId: selectedEmployee?.company_id || api.getMasterCompanyContext() || null,
          employeeId: selectedEmployeeId,
          employeeName: selectedEmployee?.full_name || "Colaborador",
          workplaceId: selectedWorkplaceId,
          workplaceName: selectedWorkplace?.name || "Sede",
          deliveryDate: selectedDeliveryDateIso,
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

  const saveForLaterSignature = async () => {
    if (savingRef.current) return
    if (facialTransactionLocked) { toast.warning("Consulte a confirmação facial em andamento antes de registrar outra entrega."); return }
    if (cart.length === 0) {
      toast.error("Adicione pelo menos um EPI à lista de entrega.")
      return
    }
    if (!selectedEmployeeId) {
      toast.error("Selecione o colaborador antes de continuar.")
      return
    }
    if (!validateCartForDelivery()) return

    savingRef.current = true
    try {
      setIsSaving(true)
      setOperationError(null)
      const currentOperation = getOperation("later")
      const selectedDeliveryDateIso = currentOperation.deliveryDate
      const savedDeliveries = await runOperation(currentOperation)
      const autoReturnedDeliveryIds = currentOperation.items.flatMap((entry) => entry.returns.filter((allocation) => allocation.state === "done").map((allocation) => allocation.deliveryId))

      const deliveryIds = savedDeliveries.map((delivery) => delivery.id).filter(Boolean)
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
      const data = await api.createRemoteLink({
        employee_id: selectedEmployeeId,
        type: 'delivery',
        data: {
          e: selectedEmployeeId,
          p: cart[0].ppeId,
          w: selectedWorkplaceId,
          thirdPartyId: selectedThirdPartyId,
          q: cart[0].quantity,
          r: cart[0].reason,
          deliveryIds,
          deliveryDate: selectedDeliveryDateIso,
          employeeName: selectedEmployee?.full_name || "Colaborador",
          workplaceName: selectedWorkplace?.name || "Sede",
          items: cart,
          signaturePendingOnly: true,
          autoReturnedDeliveryIds,
        },
        expires_hours: remoteWaitHours
      })
      const url = `${baseUrl}/delivery/remote?t=${data.link.token}`
      persistPendingDraft({
        token: data.link.token,
        linkUrl: url,
        status: "pending",
        expiresAt: data.link.expires_at,
        companyId: selectedEmployee?.company_id || api.getMasterCompanyContext() || null,
        employeeId: selectedEmployeeId,
        employeeName: selectedEmployee?.full_name || "Colaborador",
        workplaceId: selectedWorkplaceId,
        workplaceName: selectedWorkplace?.name || "Sede",
        deliveryDate,
        item: cart[0],
        items: cart,
        deliveryIds,
        signaturePendingOnly: true,
      })

      const copied = await copyTextToClipboard(url)
      setViewMode("pending")
      setStep(1)
      setCart([])
      clearOperation()
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

      toast.success(copied
        ? `Entrega registrada, estoque baixado e link de assinatura copiado.`
        : `Entrega registrada e enviada para Pendencias. Copie o link por la.`
      )
    } catch (err: unknown) {
      console.error("Erro ao registrar entrega pendente de assinatura:", err)
      const message = err instanceof Error ? err.message : "Erro ao registrar entrega pendente."
      setOperationError(message)
      toast.error(message)
    } finally {
      setIsSaving(false)
      savingRef.current = false
    }
  }

  const checkPendingDraft = useCallback(async (
    draft: PendingDeliveryDraft,
    options?: { silent?: boolean }
  ): Promise<PendingCheckResult> => {
    const silent = options?.silent === true
    try {
      if (!silent) setCheckingPendingToken(draft.token)
      const res = await fetch(`/api/remote-links?token=${draft.token}&include_completed=1`)
      const payload = await res.json()

      if (!res.ok) {
        if (payload.status === "expired") {
          updatePendingDraft(draft.token, { status: "expired" })
          if (!silent) toast.warning("Link expirado. Gere uma nova assinatura remota para esta entrega.")
          return "expired"
        } else if (!silent) {
          toast.error(payload.error || "Nao foi possivel consultar esta pendencia.")
        }
        return "error"
      }

      const status = payload.link?.status as RemoteLinkStatus | undefined
      if (status === "completed") {
        removePendingDraft(draft.token)
        if (!silent) {
          toast.success(draft.signaturePendingOnly
            ? "Assinatura concluida. A pendencia foi removida."
            : "Assinatura do colaborador concluida e entrega registrada."
          )
        }
        return "completed"
      }

      if (payload.link?.expires_at && new Date(payload.link.expires_at) < new Date()) {
        updatePendingDraft(draft.token, { status: "expired", expiresAt: payload.link.expires_at })
        if (!silent) toast.warning("Link expirado. Gere uma nova assinatura remota para esta entrega.")
        return "expired"
      }

      updatePendingDraft(draft.token, {
        status: "pending",
        expiresAt: payload.link?.expires_at || draft.expiresAt,
      })
      if (!silent) toast.info("Ainda aguardando assinatura do colaborador.")
      return "pending"
    } catch (err) {
      console.error("Erro ao consultar pendencia de assinatura:", err)
      if (!silent) toast.error("Erro ao consultar a pendencia.")
      return "error"
    } finally {
      if (!silent) setCheckingPendingToken(null)
    }
  }, [updatePendingDraft, removePendingDraft])

  const checkVisiblePendingDrafts = useCallback(async () => {
    const draftsToCheck = filteredPendingDrafts.filter((draft) => draft.status === "pending")
    if (draftsToCheck.length === 0) {
      toast.info("Nenhuma pendencia aguardando assinatura para atualizar.")
      return
    }

    setCheckingPendingToken("batch")
    try {
      const results = await Promise.all(
        draftsToCheck.map((draft) => checkPendingDraft(draft, { silent: true }))
      )
      const completed = results.filter((result) => result === "completed").length
      const expired = results.filter((result) => result === "expired").length
      const errors = results.filter((result) => result === "error").length
      const pending = results.filter((result) => result === "pending").length

      if (completed > 0) {
        toast.success(`${completed} assinatura(s) concluida(s).`)
      } else if (errors > 0) {
        toast.error("Nao foi possivel consultar uma ou mais pendencias.")
      } else if (expired > 0 && pending === 0) {
        toast.warning(`${expired} link(s) expirado(s).`)
      } else if (expired > 0) {
        toast.warning(`${expired} link(s) expirado(s); demais ainda aguardando.`)
      } else {
        toast.success(`Lista atualizada com sucesso. ${pending} pendencia(s) ainda em aberto.`)
      }
    } finally {
      setCheckingPendingToken(null)
    }
  }, [filteredPendingDrafts, checkPendingDraft])

  const reopenExpiredPendingDraft = useCallback(async (draft: PendingDeliveryDraft) => {
    if (draft.status !== "expired") return

    try {
      setReopeningPendingToken(draft.token)
      const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
      const draftItems = draft.items && draft.items.length > 0 ? draft.items : [draft.item]
      const firstItem = draftItems[0]
      const linkData = {
        e: draft.employeeId,
        p: firstItem.ppeId,
        w: draft.workplaceId,
        q: firstItem.quantity,
        r: firstItem.reason,
        deliveryDate: draft.deliveryDate,
        employeeName: draft.employeeName,
        workplaceName: draft.workplaceName,
        items: draftItems,
        ...(draft.deliveryIds?.length ? { deliveryIds: draft.deliveryIds } : {}),
        ...(draft.signaturePendingOnly ? { signaturePendingOnly: true } : {}),
        ...(firstItem.autoReturnDeliveryIds?.length ? { autoReturnedDeliveryIds: firstItem.autoReturnDeliveryIds } : {}),
      }

      const data = await api.createRemoteLink({
        employee_id: draft.employeeId,
        type: "delivery",
        data: linkData,
        expires_hours: remoteWaitHours,
      })
      const url = `${baseUrl}/delivery/remote?t=${data.link.token}`

      removePendingDraft(draft.token)
      persistPendingDraft({
        ...draft,
        token: data.link.token,
        linkUrl: url,
        status: "pending",
        expiresAt: data.link.expires_at,
      })

      const copied = await copyTextToClipboard(url)
      toast.success(copied
        ? `Link reaberto e copiado. Valido por ${remoteWaitHours}h.`
        : `Link reaberto. Use Copiar ou Abrir no novo card.`
      )
    } catch (err) {
      console.error("Erro ao reabrir link expirado:", err)
      const message = err instanceof Error ? err.message : "Nao foi possivel reabrir o link."
      toast.error(message)
    } finally {
      setReopeningPendingToken(null)
    }
  }, [remoteWaitHours, removePendingDraft, persistPendingDraft])

  useEffect(() => {
    if (viewMode !== "pending") return
    if (typeof window === "undefined") return

    const REFRESH_INTERVAL_MS = 15000

    const tick = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      try {
        await loadPendingDrafts()
      } catch {
        // best-effort sync
      }

      const drafts = pendingDraftsRef.current
      for (const draft of drafts) {
        if (draft.status !== "pending") continue
        try {
          await checkPendingDraft(draft, { silent: true })
        } catch {
          // best-effort check
        }
      }
    }

    const intervalId = window.setInterval(() => { void tick() }, REFRESH_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void tick()
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    void tick()

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [viewMode, loadPendingDrafts, checkPendingDraft])

  const restorePendingDraft = (draft: PendingDeliveryDraft) => {
    if (draft.signaturePendingOnly) {
      void copyTextToClipboard(draft.linkUrl).then((copied) => {
        if (copied) {
          toast.success("Esta entrega ja foi registrada. Link de assinatura copiado.")
        } else {
          toast.info("Esta entrega ja foi registrada. Abra o link para colher a assinatura.")
        }
      })
      return
    }
    setSelectedEmployeeId(draft.employeeId)
    setSelectedWorkplaceId(draft.workplaceId)
    setDeliveryDate(getDateOnlyValue(draft.deliveryDate))
    setCurrentPpeId(draft.item.ppeId)
    setCurrentQuantity(draft.item.quantity)
    setCurrentReason(draft.item.reason)
    setCart([draft.item])
    setStep(1)
    setViewMode("new")
  }

  if (user && !["MASTER", "ADMIN", "ALMOXARIFE"].includes(user.role || "")) {
    return (
      <div className="flex flex-col items-center justify-center py-40 text-center">
        <ShieldAlert className="w-14 h-14 text-slate-300 mb-4" />
        <h2 className="text-xl font-black text-slate-700 uppercase tracking-tighter">Acesso Restrito</h2>
        <p className="text-slate-400 text-sm font-medium mt-2">Seu perfil permite consulta. Solicite a um operador autorizado o registro da entrega.</p>
      </div>
    )
  }

  if (loadingOptions) {
      return (
          <div className="flex flex-col items-center justify-center py-40">
              <LoadingState
                variant="page"
                label={`Sincronizando sessao ${COMPANY_CONFIG.shortName}`}
                detail="Carregando colaboradores, EPIs e obras para uma nova entrega."
              />
          </div>
      )
  }

  if (optionsError) return <DataLoadError title="Não foi possível preparar a entrega" message={optionsError} onRetry={() => setOptionsReload((version) => version + 1)} />

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
    <div className="mx-auto max-w-7xl overflow-x-hidden p-4 pb-24 md:p-5 lg:p-6 lg:pb-8">
      <div className="mb-5">
        <h1 className="text-2xl lg:text-[28px] font-bold text-slate-900 tracking-tight">Nova entrega de EPIs</h1>
        <p className="text-slate-500 text-sm mt-1">Selecione o colaborador, confira os equipamentos e registre o recebimento.</p>
      </div>

      {operation && <div role="status" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Pedido em andamento · {operation.items.filter((entry) => entry.deliveryId).length} de {operation.items.length} itens confirmados</p>
        <p className="mt-1">O pedido está preservado nesta aba. Retome abaixo; os itens já registrados não serão entregues novamente. A edição fica bloqueada até a conclusão.</p>
        {operationError && <p role="alert" className="mt-2 font-medium">{operationError}</p>}
        {operation.mode === "later" && <button type="button" disabled={isSaving} onClick={() => void saveForLaterSignature()} className="mt-3 min-h-11 rounded-xl bg-amber-800 px-4 py-2 font-semibold text-white disabled:opacity-50">{isSaving ? "Retomando…" : "Retomar entrega e gerar link"}</button>}
        <a className="mt-3 inline-flex min-h-11 items-center px-3 font-semibold underline" href="/history" target="_blank" rel="noopener noreferrer">Conferir histórico</a>
      </div>}

      <div className="mb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="grid grid-cols-2 bg-slate-100 border border-slate-200 p-1 rounded-2xl w-full lg:w-auto">
          <button
            disabled={isSaving || facialTransactionLocked || !!operation}
            onClick={() => setViewMode("new")}
            className={`px-4 sm:px-6 py-3 rounded-xl text-xs sm:text-xs font-semibold flex items-center justify-center gap-2 transition-all ${viewMode === "new" ? "bg-white text-[#2563EB] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            <Plus className="w-4 h-4" /> Nova Entrega
          </button>
          <button
            disabled={isSaving || facialTransactionLocked || !!operation}
            onClick={() => setViewMode("pending")}
            className={`px-4 sm:px-6 py-3 rounded-xl text-xs sm:text-xs font-semibold flex items-center justify-center gap-2 transition-all ${viewMode === "pending" ? "bg-white text-amber-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            <Hourglass className="w-4 h-4" /> Pendencias
            {pendingDrafts.length > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-xs flex items-center justify-center">
                {pendingDrafts.length}
              </span>
            )}
          </button>
        </div>

      </div>

      {viewMode === "pending" && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SignatureSummaryCard label="Total" value={pendingSignatureSummary.total} tone="slate" />
          <SignatureSummaryCard label="Em aberto" value={pendingSignatureSummary.pending} tone="amber" />
          <SignatureSummaryCard label="Expirado" value={pendingSignatureSummary.expired} tone="red" />
        </div>
      )}

      {viewMode === "pending" ? (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-lg shadow-slate-200/40 animate-in fade-in">
          <div className="p-4 border-b border-slate-100 bg-amber-50/50 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                <Hourglass className="w-5 h-5 text-amber-600" />
                Pendencias de Assinatura
              </h2>
              <p className="text-xs text-amber-700 font-bold mt-1 flex items-center gap-2 flex-wrap">
                Entregas de EPI aguardando assinatura do colaborador.
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-xs uppercase tracking-widest">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                  Auto-refresh 15s
                </span>
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 lg:items-center">
              <div className="relative min-w-0 sm:w-80">
                <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={pendingSearchTerm}
                  onChange={(event) => setPendingSearchTerm(event.target.value)}
                  placeholder="Buscar por colaborador, EPI ou CA..."
                  className="w-full bg-white border border-slate-200 text-slate-700 rounded-xl pl-11 pr-4 py-2.5 outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-100 transition-all text-xs font-bold"
                />
              </div>
              <button
                onClick={() => void checkVisiblePendingDrafts()}
                disabled={filteredPendingDrafts.length === 0 || checkingPendingToken !== null}
                className="min-h-11 bg-white border border-amber-200 text-amber-700 px-4 py-2.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 hover:bg-amber-50 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${checkingPendingToken ? "animate-spin" : ""}`} /> Atualizar Status
              </button>
            </div>
          </div>

          <div className="p-3 sm:p-4">
            {pendingDrafts.length === 0 || filteredPendingDrafts.length === 0 ? (
              <div className="py-16 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50">
                <CheckCircle2 className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-black text-slate-500 uppercase tracking-widest">
                  {pendingDrafts.length === 0 ? "Nenhuma pendencia de assinatura" : "Nenhuma pendencia encontrada"}
                </p>
                <p className="text-xs text-slate-400 mt-2 font-medium">
                  {pendingDrafts.length === 0
                    ? "Quando gerar um link remoto de EPI, ele aparece aqui."
                    : "Tente buscar pelo nome do colaborador, EPI, CA ou unidade."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                {filteredPendingDrafts.map((draft) => {
                  const isChecking = checkingPendingToken === draft.token || checkingPendingToken === "batch"
                  const isReopening = reopeningPendingToken === draft.token
                  const statusStyle = draft.status === "completed"
                    ? "bg-green-50 text-green-700 border-green-200"
                    : draft.status === "expired"
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  const StatusIcon = draft.status === "completed" ? CheckCircle2 : draft.status === "expired" ? XCircle : Hourglass

                  return (
                    <div key={draft.token} className="border border-slate-200 rounded-2xl p-3 bg-white shadow-sm hover:shadow-md transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-800 uppercase tracking-tight truncate">{draft.employeeName}</p>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">{draft.workplaceName} - {new Date(`${getDateOnlyValue(draft.deliveryDate)}T12:00:00`).toLocaleDateString("pt-BR")}</p>
                        </div>
                        <span className={`px-3 py-1.5 rounded-full border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap ${statusStyle}`}>
                          <StatusIcon className="w-3 h-3" />
                          {draft.status === "completed" ? "Assinada" : draft.status === "expired" ? "Expirada" : "Aguardando"}
                        </span>
                      </div>

                      <div className="mt-3 bg-slate-50 border border-slate-100 rounded-2xl p-3">
                        <p className="font-black text-xs text-slate-800 uppercase tracking-tight">{draft.item.ppeName}</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-xs font-bold bg-white text-slate-500 px-2 py-0.5 rounded border border-slate-200">CA {draft.item.ppeCaNumber}</span>
                          <span className="text-xs font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Qtd: {draft.item.quantity}</span>
                          <span className="text-xs font-bold text-slate-400">{draft.item.reason}</span>
                          {draft.items && draft.items.length > 1 && (
                            <span className="text-xs font-black bg-slate-200 text-slate-600 px-2 py-0.5 rounded">+{draft.items.length - 1} EPI(s)</span>
                          )}
                          {draft.signaturePendingOnly && (
                            <span className="text-xs font-black bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100">Entregue</span>
                          )}
                          {draft.item.autoReturnDeliveryIds && draft.item.autoReturnDeliveryIds.length > 0 && (
                            <span className="text-xs font-black bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200">Baixa automática</span>
                          )}
                        </div>
                        {draft.item.autoReturnNote && (
                          <p className="mt-3 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 inline-flex">
                            {draft.item.autoReturnNote}
                          </p>
                        )}
                      </div>

                      <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                        <Clock className="w-3.5 h-3.5" />
                        {draft.status === "pending" ? `Assinatura do colaborador aguardando ate ${formatRemoteExpiry(draft.expiresAt)}` : `Ultimo prazo: ${formatRemoteExpiry(draft.expiresAt)}`}
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
                        <button
                          onClick={() => void copyTextToClipboard(draft.linkUrl).then((copied) => {
                            if (copied) {
                              toast.success("Link copiado novamente.")
                            } else {
                              toast.warning("Nao foi possivel copiar automaticamente. Abra o link e copie pela barra do navegador.")
                            }
                          })}
                          className="min-h-11 sm:col-span-1 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 font-semibold text-xs flex items-center justify-center gap-1.5"
                        >
                          <Clipboard className="w-3.5 h-3.5" /> Copiar
                        </button>
                        <a
                          href={draft.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-11 sm:col-span-1 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 font-semibold text-xs flex items-center justify-center gap-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Abrir
                        </a>
                        <button
                          onClick={() => void checkPendingDraft(draft)}
                          disabled={isChecking}
                          className="min-h-11 sm:col-span-1 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? "animate-spin" : ""}`} /> Checar
                        </button>
                        {draft.status === "expired" ? (
                          <button
                            onClick={() => void reopenExpiredPendingDraft(draft)}
                            disabled={isReopening}
                            className="min-h-11 sm:col-span-2 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 hover:border-red-300 shadow-sm font-semibold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {isReopening ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Link2 className="w-3.5 h-3.5" />
                            )}
                            Reabrir Link
                          </button>
                        ) : (
                          <button
                            onClick={() => restorePendingDraft(draft)}
                            className="min-h-11 sm:col-span-2 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
                          >
                            <Package className="w-3.5 h-3.5" /> {draft.signaturePendingOnly ? "Copiar" : "Reabrir"}
                          </button>
                        )}
                        <button
                          onClick={() => removePendingDraft(draft.token)}
                          className="min-h-11 sm:col-span-1 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-semibold text-xs flex items-center justify-center gap-1.5"
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
        <div className="flex bg-slate-50 border-b border-slate-100">
          <div className={`flex-1 text-center px-2 py-4 text-sm font-semibold ${step === 1 ? 'bg-white text-[#2563EB] border-b-2 border-[#2563EB]' : 'text-slate-500 border-b-2 border-transparent'}`}>1. Colaborador e EPIs</div>
          <div className={`flex-1 text-center px-2 py-4 text-sm font-semibold ${step === 2 ? 'bg-white text-[#2563EB] border-b-2 border-[#2563EB]' : 'text-slate-500 border-b-2 border-transparent'}`}>2. Conferência e assinatura</div>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">
          {step === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 animate-in fade-in slide-in-from-left-4">
              
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
                    <p className="text-xs font-medium text-slate-500 italic mt-0.5">Entregas retroativas.</p>
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
                  <label htmlFor="employee-select" className="text-xs font-black text-slate-400 uppercase tracking-widest flex justify-between">
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
                                      <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase tracking-widest">
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
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <span>Unidade / Local</span>
                    {selectedWorkplace && (
                      <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded font-semibold">
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

              <div className="lg:col-span-7 space-y-6 flex flex-col h-full">
                <div className="mb-2 hidden lg:block">
                  <h2 className="text-lg font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2"><Package className="w-5 h-5 text-[#2563EB]"/> Equipamentos</h2>
                  <p className="text-xs text-slate-400 font-medium mt-1">Busque os EPIs e adicione ao carrinho.</p>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
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
                              const expired = isDateOnlyPast(ppe.ca_expiry_date)
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
                                      <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded">CA {ppe.ca_number}</span>
                                      {expired && <span className="text-xs font-black bg-red-100 text-red-600 px-2 py-0.5 rounded">Vencido</span>}
                                      {inCart && <span className="text-xs font-black bg-green-100 text-green-600 px-2 py-0.5 rounded">Na lista</span>}
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

                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="quantity-input" className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Quantidade</label>
                          <input 
                            id="quantity-input" type="number" min="1" max="100" title="Quantidade do EPI"
                            className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl px-4 py-4 md:py-3 outline-none focus:border-[#2563EB] focus:bg-white transition-all font-bold text-sm text-center"
                            value={currentQuantity}
                            onChange={(e) => setCurrentQuantity(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                          />
                        </div>
                        <div>
                          <label htmlFor="reason-select" className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Motivo</label>
                          <select
                            id="reason-select" title="Motivo da entrega"
                            value={currentReason} onChange={(e) => setCurrentReason(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl px-3 py-4 md:py-3 outline-none focus:border-[#2563EB] font-bold text-sm"
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
                          <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Consultando EPIs em posse...</p>
                        </div>
                      )}

                      {!loadingActiveDeliveries && currentPpe && currentActiveSamePpeDeliveries.length > 0 && (
                        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex items-start gap-3">
                          <div className="bg-amber-100 text-amber-700 rounded-lg p-2 flex-shrink-0">
                            <ShieldAlert className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-black text-amber-800 uppercase tracking-widest">
                              {shouldAutoReturn(currentReason) ? "Baixa automática confirmada" : "Motivo definido manualmente"}
                            </p>
                            <p className="text-xs text-amber-700 font-semibold mt-1 leading-relaxed">
                              {shouldAutoReturn(currentReason)
                                ? `${selectedEmployee?.full_name || "Colaborador"} possui ${currentActiveSamePpeDeliveries.reduce((acc, delivery) => acc + getRemainingDeliveryQuantity(delivery), 0)} un. de ${currentPpe.name}. A baixa sera parcial e somente na quantidade informada.`
                                : `${selectedEmployee?.full_name || "Colaborador"} ja possui este EPI. O sistema nao alterara o motivo automaticamente; selecione Substituicao, Perda ou Dano somente quando for o caso.`}
                            </p>
                          </div>
                        </div>
                      )}

                      {currentPpe && currentPpe.lifespan_days > 0 && (
                        <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-orange-600 uppercase tracking-widest">Vida Útil (NR-06)</span>
                            <span className="text-xs font-bold text-orange-800">{currentPpe.lifespan_days} dias</span>
                          </div>
                          <div className="flex items-center justify-between mt-1 pt-3 border-t border-orange-200/50">
                            <span className="text-xs font-black text-orange-600 uppercase tracking-widest flex items-center gap-1">
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
                        className="w-full bg-slate-800 hover:bg-slate-900 text-white disabled:bg-slate-300 py-4 rounded-xl font-semibold text-xs sm:text-xs transition-all flex items-center justify-center gap-2 mt-2"
                      >
                        <Plus className="w-4 h-4" /> Adicionar à Entrega
                      </button>
                    </div>
                  </div>
                </div>

                {cart.length > 0 && (
                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Package className="w-4 h-4" />
                      EPIs Adicionados ({cart.length})
                    </label>
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl divide-y divide-slate-200 overflow-hidden">
                      {cart.map((item) => (
                        <div key={item.ppeId} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <p className="font-black text-sm text-slate-800 uppercase tracking-tight">{item.ppeName}</p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <span className="text-xs font-bold bg-white text-slate-500 px-2 py-0.5 rounded border border-slate-200">CA {item.ppeCaNumber}</span>
                              <span className="text-xs font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Qtd: {item.quantity}</span>
                              <span className="text-xs font-bold text-slate-400">{item.reason}</span>
                              {item.autoReturnDeliveryIds && item.autoReturnDeliveryIds.length > 0 && (
                                <span className="text-xs font-black bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200">Baixa automática</span>
                              )}
                            </div>
                            {item.autoReturnNote && (
                              <p className="mt-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 inline-flex">
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
                    className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white disabled:bg-slate-300 py-5 rounded-2xl font-semibold text-xs transition-all shadow-xl shadow-blue-900/10 shadow-lg shadow-blue-900/15 flex items-center justify-center gap-2"
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
                    <span className="bg-[#2563EB] text-white text-xs font-black px-2 py-1 rounded uppercase tracking-widest">NR-06 Compliance</span>
                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest italic">{selectedWorkplace?.name || "Sede"}</span>
                </div>
                <p className="font-medium text-slate-700 leading-relaxed text-sm">
                  &ldquo;Eu, <strong className="font-black text-slate-900 uppercase">{selectedEmployee?.full_name}</strong>, recebo nesta data os seguintes EPIs, declarando ter sido treinado para seu uso adequado:&rdquo;
                </p>
                <ul className="mt-4 space-y-2">
                  {cart.map(item => (
                    <li key={item.ppeId} className="text-xs text-slate-600 font-bold flex items-start gap-2 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                      <span className="w-1.5 h-1.5 bg-[#2563EB] rounded-full flex-shrink-0 mt-1.5" />
                      <span>
                        {item.ppeName} <span className="text-slate-400 font-medium">(CA {item.ppeCaNumber})</span> <br className="sm:hidden" /><span className="sm:ml-2 text-[#2563EB] bg-red-50 px-2 py-0.5 rounded text-xs tracking-widest">Qtd: {item.quantity}</span>
                        {item.autoReturnNote && (
                          <span className="block mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
                            {item.autoReturnNote}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {locationStatus !== "granted" && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-amber-900">Localização obrigatória</p>
                        <p className="mt-1 text-sm font-medium leading-relaxed text-amber-800">
                          {locationError || "Permita a localização do navegador antes de concluir a assinatura auditável."}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void requestLocationForSignature(true)}
                      disabled={locationStatus === "requesting"}
                      className="min-h-[44px] w-full rounded-xl bg-amber-600 px-4 py-3 text-xs font-semibold text-white shadow-lg shadow-amber-900/10 transition-all hover:bg-amber-700 disabled:opacity-60 sm:w-auto"
                    >
                      {locationStatus === "requesting" ? "Solicitando..." : "Permitir localização"}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid w-full min-w-0 max-w-full grid-cols-2 gap-1.5 overflow-hidden rounded-2xl bg-slate-100 p-1.5">
                <button 
                  disabled={isSaving || facialTransactionLocked || !!operation}
                  onClick={() => { setAuthMethod('manual'); setCapturedPhotoBase64(null) }}
                  className={`flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-4 text-center text-xs font-semibold transition-all sm:text-xs ${authMethod === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <PenLine className="w-4 h-4" /> Assinatura na Tela
                </button>
                <button 
                  disabled={isSaving || facialTransactionLocked || !!operation}
                  onClick={() => { setAuthMethod('manual_facial'); setCapturedPhotoBase64(null) }}
                  className={`flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-4 text-center text-xs font-semibold transition-all sm:text-xs ${authMethod === 'manual_facial' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Camera className="w-4 h-4" /> Foto + Assinatura
                </button>
                <button 
                  disabled={isSaving || facialTransactionLocked || !!operation || process.env.NEXT_PUBLIC_FACIAL_V2_ENABLED !== "true"}
                  onClick={() => { setAuthMethod('facial'); setCapturedPhotoBase64(null) }}
                  className={`flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-4 text-center text-xs font-semibold transition-all sm:text-xs ${authMethod === 'facial' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Fingerprint className="w-4 h-4" /> Biometria Facial
                </button>
                <button type="button" disabled={isSaving || facialTransactionLocked || !!operation} onClick={() => { setAuthMethod('fingerprint'); setFingerprintEvidence(null) }} className={`min-h-11 rounded-xl px-3 py-3 text-sm font-semibold ${authMethod === 'fingerprint' ? 'bg-white text-[var(--brand-color)] shadow-sm' : 'text-slate-600'}`}>
                  <span className="flex items-center justify-center gap-2"><Fingerprint className="h-4 w-4" />Leitor de digital USB</span>
                </button>
              </div>
              {process.env.NEXT_PUBLIC_FACIAL_V2_ENABLED !== "true" && <p className="text-xs text-slate-500">Reconhecimento facial em preparação. Use assinatura na tela, foto de apoio ou leitor USB configurado.</p>}
              {locationStatus === "granted" && <p className="text-xs text-slate-500">{locationSource === "network" ? "Localização aproximada da rede (não GPS)" : "Localização informada pelo dispositivo"}</p>}

              {!operation && <details open={remoteOptionsOpen} onToggle={(event) => setRemoteOptionsOpen(event.currentTarget.open)} className="rounded-xl border border-slate-200 p-3 text-sm">
                <summary className="min-h-11 cursor-pointer py-3 font-semibold text-slate-700">Assinar por link ou depois</summary>
                <label className="flex flex-wrap items-center justify-between gap-3 py-3">Validade do link
                  <select aria-label="Validade do link remoto" value={remoteWaitHours} onChange={(event) => setRemoteWaitHours(Number(event.target.value))} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base">
                    {[1, 4, 8, 12, 24, 48].map((hours) => <option key={hours} value={hours}>{hours} horas</option>)}
                  </select>
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" disabled={isSaving} onClick={() => void generateRemoteLink()} className="min-h-11 rounded-xl border border-slate-300 px-3 py-3 font-semibold">Enviar link para assinatura</button>
                  <button type="button" disabled={isSaving} onClick={() => void saveForLaterSignature()} className="min-h-11 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 font-semibold text-amber-900">Entregar agora e assinar depois</button>
                </div>
              </details>}

              {operation?.mode === "later" ? <p className="text-sm text-slate-600">Continue pelo botão “Retomar entrega e gerar link” acima.</p> : authMethod === 'manual' || authMethod === 'manual_facial' ? (
                <div className="space-y-4 animate-in fade-in">
                  {authMethod === 'manual_facial' && !capturedPhotoBase64 && (
                      <>
                        <FaceCamera
                          mode="evidence"
                          employeeLabel={selectedEmployee?.full_name}
                          onCapture={(_, img) => setCapturedPhotoBase64(img)}
                          onCancel={() => { setAuthMethod('manual'); setCapturedPhotoBase64(null) }}
                        />
                      </>
                  )}
                  {authMethod === 'manual_facial' && capturedPhotoBase64 && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
                      <Image src={capturedPhotoBase64} alt="Foto capturada agora" width={44} height={44} className="w-11 h-11 rounded-xl object-cover border border-emerald-200" unoptimized />
                      <p className="text-xs font-black text-emerald-800 uppercase tracking-widest leading-relaxed">
                        Foto registrada como evidência visual, sem verificação biométrica. Assine manualmente abaixo.
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
                  <div className="hidden justify-between items-end px-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Área de Assinatura</label>
                    <button onClick={clearSignature} className="text-xs font-black text-[#2563EB] uppercase hover:underline italic bg-red-50 px-3 py-1 rounded-lg">Limpar Traço</button>
                  </div>
                  <SignatureCapture
                    signatureRef={sigCanvas}
                    isSaving={isSaving}
                    confirmLabel={`Confirmar entrega (${cart.length} EPI${cart.length !== 1 ? 'S' : ''})`}
                    onClear={clearSignature}
                    onConfirm={handleManualSave}
                  />
                    </>
                  )}
                </div>
              ) : authMethod === 'fingerprint' ? (
                <div className="space-y-4">
                  {!operation && <FingerprintCommandPanel employeeId={selectedEmployeeId} employeeName={selectedEmployee?.full_name || "Colaborador"} operation="verify" onCompleted={setFingerprintEvidence} onReset={() => setFingerprintEvidence(null)} />}
                  <button type="button" disabled={isSaving || (!operation?.fingerprintEventId && fingerprintEvidence?.status !== 'completed')} onClick={() => void saveDelivery(undefined, undefined, fingerprintEvidence || undefined)} className="min-h-12 w-full rounded-xl bg-[var(--brand-color)] px-4 py-3 font-semibold text-white disabled:opacity-50">{isSaving ? "Registrando entrega…" : operation ? "Retomar pedido com a digital registrada" : `Confirmar entrega (${cart.length} EPI${cart.length !== 1 ? 's' : ''})`}</button>
                </div>
              ) : (
                <div className="space-y-4 animate-in zoom-in-95">
                      <FacialDeliveryConfirmation
                        employeeId={selectedEmployeeId}
                        employeeLabel={selectedEmployee?.full_name || "Colaborador selecionado"}
                        context={{ employee_id: selectedEmployeeId, workplace_id: selectedWorkplaceId || null, third_party_id: selectedThirdPartyId, delivery_date: facialDeliveryDateIso, items: cart.map(item => ({ ppe_id: item.ppeId, quantity: item.quantity, reason: item.reason })) }}
                        items={cart.map(item => ({name:item.ppeName,quantity:item.quantity,ca:item.ppeCaNumber}))}
                        onConfirm={(submission,image) => saveDelivery(image,submission)}
                        onManual={() => setAuthMethod('manual')}
                        onTransactionLocked={setFacialTransactionLocked}
                      />
                      {cart.some(item => item.autoReturnAllocations?.length) && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Na modalidade facial, devoluções anteriores devem ser registradas separadamente em Movimentações. Esta confirmação registra somente os EPIs recebidos agora.</p>}
                </div>
              )}

              <div className="pt-6 flex justify-center border-t border-slate-100">
                <button disabled={isSaving || facialTransactionLocked || !!operation} onClick={() => setStep(1)} className="text-slate-600 font-semibold text-sm hover:text-slate-800 transition-colors bg-slate-50 px-6 py-3 rounded-xl disabled:opacity-50">
                  ← Voltar e Alterar EPIs
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

function SignatureSummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "slate" | "amber" | "red" | "green"
}) {
  const toneClass = {
    slate: "border-slate-200 bg-white text-slate-800",
    amber: "border-amber-200 bg-amber-50/70 text-amber-800",
    red: "border-red-200 bg-red-50/70 text-red-700",
    green: "border-emerald-200 bg-emerald-50/70 text-emerald-700",
  }[tone]

  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClass}`}>
      <p className="text-xs font-semibold opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black leading-none">{value}</p>
    </div>
  )
}
