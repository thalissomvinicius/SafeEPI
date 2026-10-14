// responsive: revisado — mobile-first ✓
"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import SignatureCanvas from "react-signature-canvas"
import { ArrowRightLeft, Search, Calendar, Filter, FileSpreadsheet, Loader2, ArrowUpRight, ArrowDownLeft, Shield, Users, FileDown, Presentation, PenTool, Trash2 } from "lucide-react"
import { api } from "@/services/api"
import { useAuth } from "@/contexts/AuthContext"
import { useRouter } from "next/navigation"
import { format, startOfMonth, endOfMonth, subDays, isWithinInterval } from "date-fns"
import { ptBR } from "date-fns/locale"
import { DeliveryWithRelations, Employee, SignedDocument, Workplace } from "@/types/database"
import { exportDeliveriesToExcel } from "@/utils/excelExporter"
import { generateDeliveryPDF, generateMovementsSimplePDF, generateMovementsPresentationPDF } from "@/utils/pdfGenerator"
import { usePdfActionDialog } from "@/hooks/usePdfActionDialog"
import { formatDeliveryDate, formatDeliveryTime, parseDeliveryDateTime, parseLocalDateOnly } from "@/lib/dateOnly"
import { toast } from "@/lib/toast"
import { BottomSheet } from "@/components/ui/BottomSheet"
import { LoadingState } from "@/components/ui/LoadingState"
import { DataLoadError } from "@/components/ui/DataLoadError"
import { fetchImageDataUrl } from "@/utils/imageDataUrl"

type DateFilter = 'all' | 'month' | 'last30' | 'last60' | 'last90' | 'custom' | 'specific_month'
type DeliveryScopeFilter = 'own' | 'third_party' | 'all'
type PdfReportType = 'simple' | 'presentation'

export default function MovementsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const { openPdfDialog, pdfActionDialog } = usePdfActionDialog()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasMoreRecords, setHasMoreRecords] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [visibleMovementCount, setVisibleMovementCount] = useState(100)
  const [rawDeliveries, setRawDeliveries] = useState<DeliveryWithRelations[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [signedDocuments, setSignedDocuments] = useState<SignedDocument[]>([])
  const [downloadingDeliveryId, setDownloadingDeliveryId] = useState<string | null>(null)
  const [creatingSignatureLinkId, setCreatingSignatureLinkId] = useState<string | null>(null)
  const [showPdfModal, setShowPdfModal] = useState(false)
  const [selectedPdfType, setSelectedPdfType] = useState<PdfReportType>('simple')
  const [selectedTechnicianId, setSelectedTechnicianId] = useState("")
  const [technicianName, setTechnicianName] = useState("")
  const [technicianRole, setTechnicianRole] = useState("Técnico de Segurança do Trabalho")
  const [generatingPresentationPdf, setGeneratingPresentationPdf] = useState(false)
  const movementSigCanvas = useRef<SignatureCanvas | null>(null)

  // Filter State
  const [dateFilter, setDateFilter] = useState<DateFilter>('month')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [specificMonth, setSpecificMonth] = useState<string>('')
  const [specificMonthSel, setSpecificMonthSel] = useState<string>(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [specificYearSel, setSpecificYearSel] = useState<string>(String(new Date().getFullYear()))
  const [searchTerm, setSearchTerm] = useState("")
  const [employeeFilterId, setEmployeeFilterId] = useState("")
  const [deliveryScopeFilter, setDeliveryScopeFilter] = useState<DeliveryScopeFilter>('own')
  const invalidCustomPeriod = dateFilter === "custom" && (!customStartDate || !customEndDate || customStartDate > customEndDate)
  const hasThirdPartyFeature = Boolean(user)

  // Auth protection
  useEffect(() => {
    if (!authLoading && user && user.role === 'ALMOXARIFE') {
      router.push('/')
    }
  }, [user, authLoading, router])

  const loadData = useCallback(async () => {
    if (!user || user.role === 'ALMOXARIFE') return
    try {
      setLoading(true)
      setLoadError(null)
      const [deliveryData, documentData, employeeData, workplaceData] = await Promise.all([
        // Os arquivos privados so recebem URL temporaria quando o usuario os abre.
        // Isso evita dezenas de lotes de assinatura e o limite do endpoint na carga da tela.
        api.getDeliveries({ signAssets: false }),
        api.getSignedDocuments({ signAssets: false }),
        hasThirdPartyFeature ? api.getEmployees({ signPhotos: false }) : Promise.resolve([] as Employee[]),
        hasThirdPartyFeature ? api.getWorkplaces() : Promise.resolve([] as Workplace[]),
      ])
      setRawDeliveries(deliveryData)
      setHasMoreRecords(deliveryData.length === 500)
      setNextOffset(deliveryData.length)
      setSignedDocuments(documentData)
      setEmployees(employeeData)
      setWorkplaces(workplaceData)
    } catch (err) {
      console.error("Erro ao carregar movimentações:", err)
      setLoadError(err instanceof Error ? err.message : "Falha ao consultar as movimentacoes.")
    } finally {
      setLoading(false)
    }
  }, [user, hasThirdPartyFeature])

  // Load Data
  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  const loadMoreRecords = async () => {
    try {
      setLoadingMore(true)
      const nextPage = await api.getDeliveries({ offset: nextOffset, limit: 500, signAssets: false })
      setRawDeliveries((current) => {
        const knownIds = new Set(current.map((delivery) => delivery.id))
        return [...current, ...nextPage.filter((delivery) => !knownIds.has(delivery.id))]
      })
      setNextOffset((offset) => offset + nextPage.length)
      setHasMoreRecords(nextPage.length === 500)
    } catch (error) {
      console.error("Erro ao carregar mais movimentações:", error)
      toast.error("Não foi possível carregar mais registros. Os dados anteriores foram mantidos.")
    } finally {
      setLoadingMore(false)
    }
  }

  const employeeThirdPartyById = new Map(employees.map((employee) => [employee.id, employee.third_party_id || null]))
  const workplaceThirdPartyById = new Map(workplaces.map((workplace) => [workplace.id, workplace.third_party_id || null]))

  const getDeliveryThirdPartyId = (delivery: DeliveryWithRelations) =>
    delivery.third_party_id ||
    delivery.employee?.third_party_id ||
    delivery.workplace?.third_party_id ||
    employeeThirdPartyById.get(delivery.employee_id) ||
    workplaceThirdPartyById.get(delivery.workplace_id || "") ||
    null

  const technicianOptions = useMemo(() => {
    const activeEmployees = employees.filter((employee) => employee.active)
    const technicalEmployees = activeEmployees.filter((employee) => {
      const text = `${employee.job_title || ""} ${employee.department || ""}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
      return (
        text.includes("tecnico") ||
        text.includes("seguranca") ||
        text.includes("tst") ||
        text.includes("sesmt")
      )
    })

    return technicalEmployees.length > 0 ? technicalEmployees : activeEmployees
  }, [employees])

  const handleTechnicianSelect = (employeeId: string) => {
    setSelectedTechnicianId(employeeId)
    const technician = technicianOptions.find((employee) => employee.id === employeeId)
    setTechnicianName(technician?.full_name || "")
    setTechnicianRole(technician?.job_title || "Técnico de Segurança do Trabalho")
  }

  // Filter Logic
  const getFilteredData = () => {
    let filtered = rawDeliveries
    if (employeeFilterId) filtered = filtered.filter((delivery) => delivery.employee_id === employeeFilterId)
    const now = new Date()

    if (dateFilter !== 'all') {
      let start: Date | null = null
      let end: Date = now

      if (dateFilter === 'month') {
        start = startOfMonth(now)
        end = endOfMonth(now)
      } else if (dateFilter === 'last30') {
        start = subDays(now, 30)
      } else if (dateFilter === 'last60') {
        start = subDays(now, 60)
      } else if (dateFilter === 'last90') {
        start = subDays(now, 90)
      } else if (dateFilter === 'custom' && customStartDate && customEndDate) {
        start = parseLocalDateOnly(customStartDate)
        const localEnd = parseLocalDateOnly(customEndDate)
        end = localEnd ? new Date(localEnd.getFullYear(), localEnd.getMonth(), localEnd.getDate(), 23, 59, 59, 999) : end
      } else if (dateFilter === 'specific_month' && specificMonth) {
        start = parseLocalDateOnly(`${specificMonth}-01`)
        end = start ? endOfMonth(start) : end
      }

      if (start) {
        filtered = filtered.filter(d => {
          const dDate = parseDeliveryDateTime(d.delivery_date)
          if (!dDate) return false
          return isWithinInterval(dDate, { start: start!, end })
        })
      }
    }

    if (hasThirdPartyFeature && deliveryScopeFilter !== 'all') {
      filtered = filtered.filter((delivery) => {
        const isThirdPartyDelivery = Boolean(getDeliveryThirdPartyId(delivery))
        return deliveryScopeFilter === 'third_party' ? isThirdPartyDelivery : !isThirdPartyDelivery
      })
    }

    if (searchTerm) {
      const lower = searchTerm.toLowerCase()
      filtered = filtered.filter(d =>
        d.employee?.full_name.toLowerCase().includes(lower) ||
        d.ppe?.name.toLowerCase().includes(lower) ||
        d.employee?.cpf.includes(searchTerm)
      )
    }

    return filtered.sort((a, b) => {
      const dateA = parseDeliveryDateTime(a.delivery_date)?.getTime() || 0
      const dateB = parseDeliveryDateTime(b.delivery_date)?.getTime() || 0
      return dateB - dateA
    })
  }

  const filteredMovements = getFilteredData()

  const getSignedDocumentForDelivery = (deliveryId: string) =>
    signedDocuments.find((document) =>
      (document.document_type === "delivery" || document.document_type === "remote_delivery") &&
      (document.delivery_id === deliveryId || document.delivery_ids?.includes(deliveryId))
    )

  const handleDeliveryReceiptPDF = async (delivery: DeliveryWithRelations) => {
    if (!delivery.signature_url && delivery.auth_method !== "fingerprint") {
      toast.error("Esta entrega não possui assinatura digital.")
      return
    }

    try {
      setDownloadingDeliveryId(delivery.id)
      const signedDocument = getSignedDocumentForDelivery(delivery.id)

      if (signedDocument?.document_url) {
        const documentUrl = await api.getPrivateAssetUrl(
          signedDocument.storage_path || signedDocument.document_url,
          "download",
          signedDocument.file_name || `Comprovante_${delivery.id.slice(0, 8)}.pdf`,
        )
        if (!documentUrl) throw new Error("Nao foi possivel gerar o link seguro do PDF.")
        const archivedResponse = await fetch(documentUrl)
        if (!archivedResponse.ok) throw new Error("Não foi possível carregar o PDF arquivado.")
        const archivedBlob = await archivedResponse.blob()
        openPdfDialog(archivedBlob, signedDocument.file_name || `Comprovante_${delivery.id.slice(0, 8)}.pdf`, {
          title: "Comprovante arquivado",
          description: "Este e o PDF juridico original salvo no arquivo digital.",
        })
        toast.success("PDF aberto", signedDocument.file_name)
        return
      }

      let base64Signature: string | undefined
      let fingerprintEvidence: { code: string; terminalName: string; completedAt: string; resultHash: string } | undefined
      if (delivery.auth_method === "fingerprint") {
        const result = await api.getDeliveryFingerprintEvidence(delivery.id)
        fingerprintEvidence = {
          code: result.evidence.code,
          terminalName: result.evidence.terminalName || "Terminal SafeEPI",
          completedAt: result.evidence.completedAt || delivery.delivery_date,
          resultHash: result.evidence.resultHash || "",
        }
      } else {
        const signatureUrl = await api.getPrivateAssetUrl(delivery.signature_storage_path || delivery.signature_url, "download")
        if (!signatureUrl) throw new Error("Não foi possível gerar o acesso seguro à assinatura.")
        base64Signature = await fetchImageDataUrl(signatureUrl, { required: true, label: "a assinatura da entrega" }) || undefined
        if (!base64Signature) throw new Error("Não foi possível carregar a assinatura da entrega.")
      }
      let photoBase64: string | undefined
      if (signedDocument?.photo_evidence_url) {
        const photoUrl = await api.getPrivateAssetUrl(signedDocument.photo_evidence_storage_path || signedDocument.photo_evidence_url, "download")
        if (!photoUrl) throw new Error("Não foi possível gerar o acesso seguro à evidência fotográfica.")
        photoBase64 = await fetchImageDataUrl(photoUrl, { required: true, label: "a evidência fotográfica da entrega" }) || undefined
      }
      const authMethod = delivery.auth_method === "fingerprint"
        ? "fingerprint"
        : signedDocument?.auth_method === "manual_facial" || delivery.auth_method === "manual_facial"
        ? "manual_facial"
        : ((delivery.signature_url?.includes("bio_") || delivery.signature_url?.includes("emp_") || delivery.auth_method === "facial") ? "facial" : "manual")

      const pdfBlob = await generateDeliveryPDF({
        employeeName: delivery.employee?.full_name || "Desconhecido",
        employeeCpf: delivery.employee?.cpf || "Não informado",
        employeeRole: delivery.employee?.job_title || "Geral",
        workplaceName: delivery.workplace?.name || "Sede",
        ppeName: delivery.ppe?.name || "N/A",
        ppeCaNumber: delivery.ppe?.ca_number || "N/A",
        ppeCaExpiry: delivery.ppe?.ca_expiry_date,
        quantity: delivery.quantity,
        reason: delivery.reason,
        authMethod,
        signatureBase64: base64Signature,
        fingerprintEvidence,
        photoBase64,
        ipAddress: delivery.ip_address || "Remoto",
        location: signedDocument?.geo_location || undefined,
        validationHash: delivery.id.slice(0, 8).toUpperCase(),
        deliveryDate: delivery.delivery_date,
      })

      const shortId = delivery.id.slice(0, 8).toUpperCase()
      const safeName = (delivery.employee?.full_name || "Comprovante").split(" ")[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const safePpe = (delivery.ppe?.name || "EPI").split(" ")[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const fileName = `Comprovante_${shortId}_${safeName}_${safePpe}.pdf`

      openPdfDialog(pdfBlob, fileName, {
        title: "Comprovante pronto",
        description: "Visualize o comprovante em uma nova aba ou baixe o PDF completo.",
      })
      toast.success("PDF gerado com sucesso", fileName)
    } catch (err) {
      console.error("Erro ao gerar comprovante da movimentação:", err)
      toast.error("Erro ao processar o comprovante PDF.")
    } finally {
      setDownloadingDeliveryId(null)
    }
  }

  const getPendingSignatureLinkToken = async (deliveryId: string) => {
    const links = await api.getPendingDeliverySignatureLinks().catch(() => [])
    const existing = links.find((link) => {
      const deliveryIds = Array.isArray(link.data?.deliveryIds)
        ? link.data.deliveryIds.filter((id): id is string => typeof id === "string")
        : []
      return deliveryIds.includes(deliveryId)
    })

    return existing?.token || null
  }

  const openSignatureFlow = async (delivery: DeliveryWithRelations) => {
    if (!delivery.employee_id || !delivery.ppe_id) {
      toast.error("Nao foi possivel identificar colaborador ou EPI desta entrega.")
      return
    }

    try {
      setCreatingSignatureLinkId(delivery.id)
      const existingToken = await getPendingSignatureLinkToken(delivery.id)
      const token = existingToken || (await api.createRemoteLink({
        employee_id: delivery.employee_id,
        type: "delivery",
        data: {
          e: delivery.employee_id,
          p: delivery.ppe_id,
          w: delivery.workplace_id || "",
          q: delivery.quantity,
          r: delivery.reason || "Primeira Entrega",
          deliveryIds: [delivery.id],
          thirdPartyId: getDeliveryThirdPartyId(delivery),
          deliveryDate: delivery.delivery_date,
          employeeName: delivery.employee?.full_name || "Colaborador",
          workplaceName: delivery.workplace?.name || "Sede",
          items: [{
            ppeId: delivery.ppe_id,
            ppeName: delivery.ppe?.name || "EPI pendente",
            ppeCaNumber: delivery.ppe?.ca_number || "N/A",
            ppeCaExpiry: delivery.ppe?.ca_expiry_date || "",
            quantity: delivery.quantity,
            reason: delivery.reason || "Primeira Entrega",
          }],
          signaturePendingOnly: true,
        },
        expires_hours: 24,
      })).link.token

      toast.success(existingToken ? "Abrindo assinatura pendente." : "Link de assinatura criado.")
      router.push(`/delivery/remote?t=${token}`)
    } catch (error) {
      console.error("Erro ao abrir assinatura da movimentacao:", error)
      const message = error instanceof Error ? error.message : "Nao foi possivel abrir a assinatura desta entrega."
      toast.error(message)
    } finally {
      setCreatingSignatureLinkId(null)
    }
  }

  const stats = {
    deliveries: filteredMovements.filter(m => !m.returned_at).length,
    returns: filteredMovements.filter(m => m.returned_at).length,
    totalItems: filteredMovements.reduce((acc, m) => acc + m.quantity, 0),
    uniqueEmployees: new Set(filteredMovements.map(m => m.employee_id)).size
  }

  const getPeriodLabel = () => {
    if (dateFilter === 'month') return `Mês de ${format(new Date(), "MMMM 'de' yyyy", { locale: ptBR })}`
    if (dateFilter === 'last30') return 'Últimos 30 dias'
    if (dateFilter === 'last60') return 'Últimos 60 dias'
    if (dateFilter === 'last90') return 'Últimos 90 dias'
    if (dateFilter === 'all') return 'Todo o período'
    if (dateFilter === 'specific_month' && specificMonth) return `Mês ${specificMonth}`
    if (dateFilter === 'custom' && customStartDate && customEndDate) return `${customStartDate} a ${customEndDate}`
    return 'Período selecionado'
  }

  if (!loading && loadError && rawDeliveries.length === 0) {
    return (
      <DataLoadError
        title="Movimentacoes temporariamente indisponiveis"
        message={`${loadError} Nenhum indicador foi substituido por zero.`}
        onRetry={() => void loadData()}
      />
    )
  }

  const handleSimplePDF = () => {
    const blob = generateMovementsSimplePDF({ movements: filteredMovements, stats, period: getPeriodLabel() })
    openPdfDialog(blob, `Movimentacoes_Simples_${new Date().toISOString().slice(0,10)}.pdf`, {
      title: "PDF Simples - Movimentações",
      description: `Período: ${getPeriodLabel()} · ${filteredMovements.length} registros`
    })
    setShowPdfModal(false)
  }

  const handlePresentationPDF = async () => {
    if (!technicianName.trim()) {
      toast.error("Selecione o responsável técnico cadastrado no sistema.")
      return
    }
    if (!movementSigCanvas.current || movementSigCanvas.current.isEmpty()) {
      toast.error("Assine como responsável técnico antes de gerar o PDF de apresentação.")
      return
    }
    try {
      setGeneratingPresentationPdf(true)
      const blob = await generateMovementsPresentationPDF({
        movements: filteredMovements,
        stats,
        period: getPeriodLabel(),
        technicianName: technicianName || user?.user_metadata?.full_name || user?.email || "Responsável técnico",
        technicianRole,
        technicianSignatureBase64: movementSigCanvas.current.toDataURL("image/png"),
      })
    openPdfDialog(blob, `Movimentacoes_Apresentacao_${new Date().toISOString().slice(0,10)}.pdf`, {
      title: "PDF Apresentação - Movimentações",
      description: `Período: ${getPeriodLabel()} · ${filteredMovements.length} registros`
    })
    setShowPdfModal(false)
    } finally {
      setGeneratingPresentationPdf(false)
    }
  }

  const handleGenerateSelectedPDF = () => {
    if (selectedPdfType === 'simple') {
      handleSimplePDF()
      return
    }

    void handlePresentationPDF()
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1440px] mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-500">Controle operacional</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 flex items-center">
            <ArrowRightLeft className="w-6 h-6 mr-2 text-[#2563EB]" />
            Movimentações de EPI
          </h1>
          <p className="text-slate-500 text-sm mt-2 leading-6">Acompanhe entregas e devoluções por período, colaborador e vínculo.</p>
        </div>

        <div className="w-full md:w-auto flex gap-2">
          <button
            onClick={() => exportDeliveriesToExcel(filteredMovements)}
            disabled={loading || hasMoreRecords || invalidCustomPeriod || filteredMovements.length === 0}
            title="Exportar para planilha Excel"
            className="min-h-11 flex-1 md:flex-none border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-4 py-3 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel
          </button>
          <button
            onClick={() => setShowPdfModal(true)}
            disabled={loading || hasMoreRecords || invalidCustomPeriod || filteredMovements.length === 0}
            title="Gerar relatório em PDF"
            className="min-h-11 flex-1 md:flex-none border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-4 py-3 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <FileDown className="w-4 h-4" />
            PDF
          </button>
        </div>
      </div>

      {loadError && rawDeliveries.length > 0 && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">A consulta falhou. Mantivemos os registros carregados; tente atualizar novamente.</div>}
      {hasMoreRecords && !loading && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-900">Histórico carregado parcialmente</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">{rawDeliveries.length} registros carregados. Totais e busca consideram apenas estes registros; carregue os restantes para liberar relatórios completos.</p>
          </div>
          <button type="button" onClick={() => void loadMoreRecords()} disabled={loadingMore} className="min-h-11 shrink-0 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">
            {loadingMore ? "Carregando registros…" : "Carregar mais 500 registros"}
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <div className="flex-1 space-y-2 w-full">
            <label id="label-periodo" className="text-xs font-semibold text-slate-400  tracking-normal flex items-center">
              <Calendar className="w-3 h-3 mr-1" /> Período
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
              {[
                { id: 'month', label: 'Mês Atual' },
                { id: 'last30', label: '30 Dias' },
                { id: 'last90', label: '90 Dias' },
                { id: 'all', label: 'Tudo' },
              ].map(opt => (
                <button
                  key={opt.id}
                  title={`Filtrar por: ${opt.label}`}
                  onClick={() => setDateFilter(opt.id as DateFilter)}
                  className={`min-h-11 w-full px-3 py-2.5 rounded-xl text-xs font-semibold  transition-colors border ${
                    dateFilter === opt.id
                      ? "bg-[#2563EB] border-[#2563EB] text-white shadow-md shadow-blue-900/20"
                      : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-white hover:border-slate-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-2 w-full">
            <label id="label-outros" className="text-xs font-semibold text-slate-400  tracking-normal flex items-center">
              <Filter className="w-3 h-3 mr-1" /> Outros Filtros
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                title="Filtrar por mês específico"
                onClick={() => setDateFilter('specific_month')}
                className={`min-h-11 w-full px-3 py-2.5 rounded-xl text-xs font-semibold  transition-colors border ${
                  dateFilter === 'specific_month'
                    ? "bg-[#2563EB] border-[#2563EB] text-white shadow-md shadow-blue-900/20"
                    : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-white hover:border-slate-300"
                }`}
              >
                Mês Específico
              </button>
              <button
                title="Filtrar por período personalizado"
                onClick={() => setDateFilter('custom')}
                className={`min-h-11 w-full px-3 py-2.5 rounded-xl text-xs font-semibold  transition-colors border ${
                  dateFilter === 'custom'
                    ? "bg-[#2563EB] border-[#2563EB] text-white shadow-md shadow-blue-900/20"
                    : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-white hover:border-slate-300"
                }`}
              >
                Personalizado
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-2 w-full">
            <label htmlFor="search-mov" className="text-xs font-semibold text-slate-400  tracking-normal flex items-center">
              <Search className="w-3 h-3 mr-1" /> Pesquisar
            </label>
            <input
              id="search-mov"
              type="text"
              placeholder="Nome, CPF ou EPI..."
              title="Pesquisar movimentações"
              aria-label="Pesquisar movimentações"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="min-h-11 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:border-[#2563EB] outline-none transition-colors"
            />
          </div>

          {hasThirdPartyFeature && (
            <div className="flex-1 space-y-2 w-full">
              <label htmlFor="scope-mov" className="text-xs font-semibold text-slate-400  tracking-normal flex items-center">
                <Users className="w-3 h-3 mr-1" /> Vínculo
              </label>
              <select
                id="scope-mov"
                value={deliveryScopeFilter}
                onChange={(event) => setDeliveryScopeFilter(event.target.value as DeliveryScopeFilter)}
                className="min-h-11 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:border-[#2563EB] outline-none transition-colors"
              >
                <option value="own">Próprios</option>
                <option value="third_party">Terceiros</option>
                <option value="all">Todos vínculos</option>
              </select>
            </div>
          )}
        </div>

        <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0 space-y-2">
            <label htmlFor="employee-period-mov" className="text-xs font-semibold text-slate-600">Relatório de EPIs por colaborador</label>
            <select id="employee-period-mov" value={employeeFilterId} onChange={(event) => {
              setEmployeeFilterId(event.target.value)
              if (event.target.value) setDeliveryScopeFilter("all")
            }} className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none">
              <option value="">Todos os colaboradores</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
            </select>
            <p className="text-xs leading-5 text-slate-500">Selecione o colaborador e o período acima para emitir todos os EPIs juntos.</p>
          </div>
          <button type="button" onClick={() => setShowPdfModal(true)} disabled={!employeeFilterId || loading || hasMoreRecords || invalidCustomPeriod || filteredMovements.length === 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-40">
            <FileDown className="h-4 w-4" aria-hidden="true" /> Emitir EPIs do período
          </button>
        </div>
        {invalidCustomPeriod && <p role="status" className="text-sm text-amber-700">Informe as datas inicial e final em ordem válida para emitir o período personalizado.</p>}

        {/* Custom Inputs */}
        {dateFilter === 'specific_month' && (
          <div className="pt-4 border-t border-slate-50 animate-in slide-in-from-top-2">
            <label className="text-xs font-semibold text-slate-400  tracking-normal block mb-2">Selecione o Mês</label>
            <div className="flex gap-2">
              <select
                id="specific-month-sel"
                aria-label="Mês"
                title="Selecionar mês"
                value={specificMonthSel}
                onChange={e => {
                  setSpecificMonthSel(e.target.value)
                  setSpecificMonth(`${specificYearSel}-${e.target.value}`)
                }}
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:border-[#2563EB] outline-none"
              >
                {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m, i) => (
                  <option key={m} value={m}>{['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][i]}</option>
                ))}
              </select>
              <select
                id="specific-year-sel"
                aria-label="Ano"
                title="Selecionar ano"
                value={specificYearSel}
                onChange={e => {
                  setSpecificYearSel(e.target.value)
                  setSpecificMonth(`${e.target.value}-${specificMonthSel}`)
                }}
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:border-[#2563EB] outline-none"
              >
                {[2023,2024,2025,2026,2027].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {dateFilter === 'custom' && (
          <div className="pt-4 border-t border-slate-50 flex gap-4 animate-in slide-in-from-top-2">
            <div className="flex-1">
              <label htmlFor="custom-start" className="text-xs font-semibold text-slate-400  tracking-normal block mb-2">Início</label>
              <input
                id="custom-start"
                type="date"
                title="Data de início"
                aria-label="Data de início"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:border-[#2563EB] outline-none"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="custom-end" className="text-xs font-semibold text-slate-400  tracking-normal block mb-2">Fim</label>
              <input
                id="custom-end"
                type="date"
                title="Data de fim"
                aria-label="Data de fim"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold focus:border-[#2563EB] outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Stats Quick View */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Entregas", value: loading && rawDeliveries.length === 0 ? "—" : stats.deliveries, icon: ArrowUpRight, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Devoluções", value: loading && rawDeliveries.length === 0 ? "—" : stats.returns, icon: ArrowDownLeft, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Itens Movimentados", value: loading && rawDeliveries.length === 0 ? "—" : stats.totalItems, icon: Shield, color: "text-[#2563EB]", bg: "bg-red-50" },
          { label: "Pessoas Atendidas", value: loading && rawDeliveries.length === 0 ? "—" : stats.uniqueEmployees, icon: Users, color: "text-slate-600", bg: "bg-slate-50" },
        ].map((s, i) => (
          <div key={i} className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${s.bg}`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400  tracking-normal">{s.label}</p>
              <p className="text-xl font-semibold text-slate-800 tracking-tighter mt-0.5">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main List */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="min-h-[400px]">
          {loading ? (
            <LoadingState
              variant="panel"
              label="Acessando banco de dados"
              detail="Montando movimentacoes, documentos e filtros do periodo."
            />
          ) : (
            <div className="bg-slate-50/70 p-4">
              <div className="mb-3 flex flex-col gap-1 px-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-semibold  tracking-normal text-slate-400">
                  {filteredMovements.length} movimentação(ões)
                </p>
                <p className="text-xs font-semibold  tracking-normal text-slate-400">
                  {getPeriodLabel()}
                </p>
              </div>

              <div className="space-y-3">
                {filteredMovements.slice(0, visibleMovementCount).map((move, i) => {
                  const isDownloading = downloadingDeliveryId === move.id
                  const isCreatingSignatureLink = creatingSignatureLinkId === move.id
                  const isThirdPartyMovement = Boolean(getDeliveryThirdPartyId(move))
                  const movementTypeClass = move.returned_at
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-green-200 bg-green-50 text-green-700"

                  return (
                    <div key={move.id || i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold  tracking-normal ${movementTypeClass}`}>
                              {move.returned_at ? (
                                <ArrowDownLeft className="h-3 w-3" />
                              ) : (
                                <ArrowUpRight className="h-3 w-3" />
                              )}
                              {move.returned_at ? "Devolução" : "Entrega"}
                            </span>
                            <span className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold  tracking-normal text-slate-500">
                              {isThirdPartyMovement ? "Terceiro" : "Próprio"}
                            </span>
                          </div>
                          <div className="mt-3 flex items-center gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                              <Calendar className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold  tracking-tight text-slate-900">{formatDeliveryDate(move.delivery_date)}</p>
                              <p className="mt-0.5 text-xs font-semibold  tracking-normal text-slate-400">{formatDeliveryTime(move.delivery_date)}h</p>
                            </div>
                          </div>
                        </div>

                        <div className="grid min-w-0 flex-[3] grid-cols-1 gap-3 lg:grid-cols-3">
                          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                            <p className="text-xs font-semibold  tracking-normal text-slate-400">Colaborador</p>
                            <p className="mt-1 text-xs font-semibold  tracking-tight text-slate-800" title={move.employee?.full_name || "Colaborador"}>
                              {move.employee?.full_name || "Colaborador não informado"}
                            </p>
                            <p className="mt-0.5 text-xs font-semibold tracking-normal text-slate-400">{move.employee?.cpf || "CPF não informado"}</p>
                          </div>

                          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                            <p className="text-xs font-semibold  tracking-normal text-slate-400">EPI / CA</p>
                            <p className="mt-1 text-xs font-semibold  tracking-tight text-slate-800" title={move.ppe?.name || "EPI"}>
                              {move.ppe?.name || "EPI não informado"}
                            </p>
                            <p className="mt-0.5 text-xs font-semibold  tracking-normal text-slate-400">C.A. {move.ppe?.ca_number || "N/A"}</p>
                          </div>

                          <div className="grid grid-cols-[auto_1fr] gap-3">
                            <div className="flex min-h-[74px] min-w-16 flex-col items-center justify-center rounded-xl border border-slate-100 bg-slate-50 px-3">
                              <p className="text-xs font-semibold  tracking-normal text-slate-400">Qtd</p>
                              <p className="mt-1 text-2xl font-semibold leading-none text-slate-900">{move.quantity}</p>
                            </div>
                            <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                              <p className="text-xs font-semibold  tracking-normal text-slate-400">Unidade</p>
                              <p className="mt-1 truncate text-xs font-semibold  tracking-tight text-slate-800" title={move.workplace?.name || "Geral"}>
                                {move.workplace?.name || "Geral"}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
                          {move.signature_url ? (
                            <button
                              onClick={() => void handleDeliveryReceiptPDF(move)}
                              disabled={isDownloading}
                              title="Emitir comprovante de entrega do EPI"
                              className="inline-flex items-center gap-1.5 rounded-xl border border-[#2563EB] bg-[#2563EB] px-4 py-3 text-xs font-semibold  tracking-normal text-white shadow-sm shadow-blue-900/15 transition-colors hover:-translate-y-0.5 hover:bg-[#1D4ED8] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20 disabled:opacity-40"
                            >
                              {isDownloading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <FileDown className="h-4 w-4" />
                              )}
                              PDF
                            </button>
                          ) : (
                            <>
                              <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold  tracking-normal text-slate-400">Sem assinatura</span>
                              <button
                                onClick={() => void openSignatureFlow(move)}
                                disabled={isCreatingSignatureLink}
                                title="Abrir assinatura desta entrega"
                                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold  tracking-normal text-amber-700 transition-colors hover:-translate-y-0.5 hover:bg-amber-100 hover:shadow-md disabled:opacity-50"
                              >
                                {isCreatingSignatureLink ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <PenTool className="h-4 w-4" />
                                )}
                                Assinar
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {filteredMovements.length > visibleMovementCount && (
                  <div className="flex flex-col items-center gap-3 border-t border-slate-200 py-5 text-center">
                    <p className="text-xs text-slate-500">Exibindo {visibleMovementCount} de {filteredMovements.length} movimentações carregadas. Os totais incluem todos os registros carregados.</p>
                    <button type="button" onClick={() => setVisibleMovementCount((count) => count + 100)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Mostrar mais 100 movimentações</button>
                  </div>
                )}
                {filteredMovements.length === 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white px-6 py-20 text-center text-slate-400 italic">
                    <ArrowRightLeft className="w-10 h-10 mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-semibold  tracking-normal">Nenhuma movimentação neste período.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* PDF Choice Modal */}
      <BottomSheet
        open={showPdfModal}
        onClose={() => setShowPdfModal(false)}
        title={employeeFilterId ? "EPIs do colaborador no período" : "Gerar relatório PDF"}
        description={employeeFilterId ? `${employees.find((employee) => employee.id === employeeFilterId)?.full_name || "Colaborador"} · ${getPeriodLabel()}` : "Escolha o formato do relatório de movimentações."}
        className="md:max-w-5xl"
      >
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="space-y-3">
                  <p className="text-xs font-semibold  tracking-normal text-slate-400">Formato do relatório</p>
                  <button
                    type="button"
                    onClick={() => setSelectedPdfType('simple')}
                    className={`group flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-colors ${
                      selectedPdfType === 'simple'
                        ? 'border-[#2563EB] bg-blue-50 shadow-md shadow-blue-900/10'
                        : 'border-slate-100 hover:border-[#2563EB]/30 hover:bg-blue-50/50'
                    }`}
                  >
                    <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl transition-colors ${selectedPdfType === 'simple' ? 'bg-[#2563EB]/10' : 'bg-slate-100 group-hover:bg-[#2563EB]/10'}`}>
                      <FileDown className={`h-7 w-7 ${selectedPdfType === 'simple' ? 'text-[#2563EB]' : 'text-slate-500 group-hover:text-[#2563EB]'}`} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-800  tracking-tighter text-sm">PDF Simples</h3>
                      <p className="mt-1 text-[11px] text-slate-500 font-medium leading-relaxed">
                        Tabela completa e resumo de indicadores para arquivo e controle interno.
                      </p>
                      <span className={`mt-3 inline-flex text-xs font-semibold  tracking-normal px-3 py-1.5 rounded-lg ${selectedPdfType === 'simple' ? 'text-[#2563EB] bg-white border border-blue-100' : 'text-slate-400 bg-slate-100'}`}>
                        Retrato · 1 página+
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPdfType('presentation')}
                    className={`group flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-colors ${
                      selectedPdfType === 'presentation'
                        ? 'border-[#B91C1C] bg-red-50 shadow-md shadow-red-900/10'
                        : 'border-slate-100 hover:border-red-200 hover:bg-red-50/40'
                    }`}
                  >
                    <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl transition-colors ${selectedPdfType === 'presentation' ? 'bg-red-100' : 'bg-slate-100 group-hover:bg-red-100'}`}>
                      <Presentation className={`h-7 w-7 ${selectedPdfType === 'presentation' ? 'text-[#B91C1C]' : 'text-slate-500 group-hover:text-[#B91C1C]'}`} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-800  tracking-tighter text-sm">PDF Apresentação</h3>
                      <p className="mt-1 text-[11px] text-slate-500 font-medium leading-relaxed">
                        Gráficos visuais, layout executivo e assinatura para reuniões.
                      </p>
                      <span className={`mt-3 inline-flex text-xs font-semibold  tracking-normal px-3 py-1.5 rounded-lg ${selectedPdfType === 'presentation' ? 'text-[#B91C1C] bg-white border border-red-100' : 'text-slate-400 bg-slate-100'}`}>
                        Paisagem · 2 páginas
                      </span>
                    </div>
                  </button>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  {selectedPdfType === 'presentation' ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <PenTool className="w-4 h-4 text-[#B91C1C]" />
                        <p className="text-xs font-semibold  tracking-normal text-slate-500">Assinatura do responsável técnico</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[1.3fr_1fr] gap-3">
                        <select
                          value={selectedTechnicianId}
                          onChange={(e) => handleTechnicianSelect(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#2563EB]"
                          title="Selecionar responsável técnico cadastrado"
                        >
                          <option value="">Selecione um técnico cadastrado</option>
                          {technicianOptions.map((employee) => (
                            <option key={employee.id} value={employee.id}>
                              {employee.full_name}
                            </option>
                          ))}
                        </select>
                        <input
                          value={technicianRole}
                          onChange={(e) => setTechnicianRole(e.target.value)}
                          placeholder="Cargo"
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-[#2563EB]"
                        />
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                        <SignatureCanvas
                          ref={movementSigCanvas}
                          canvasProps={{
                            className: "block w-full h-28 max-w-full touch-none overscroll-contain bg-white",
                            style: {
                              touchAction: "none",
                              WebkitUserSelect: "none",
                              userSelect: "none",
                            },
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => movementSigCanvas.current?.clear()}
                        className="inline-flex items-center gap-2 text-xs font-semibold  tracking-normal text-slate-500 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Limpar assinatura
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#2563EB]/10 text-[#2563EB]">
                        <FileDown className="h-8 w-8" />
                      </div>
                      <h3 className="mt-4 text-sm font-semibold  tracking-tight text-slate-800">Pronto para gerar</h3>
                      <p className="mt-2 max-w-sm text-xs font-semibold leading-relaxed text-slate-500">
                        O PDF simples não exige assinatura e será aberto assim que você confirmar.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            <div className="mt-5 flex shrink-0 flex-col gap-3 border-t border-slate-100 bg-white pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-400 italic">
                Período: <strong>{getPeriodLabel()}</strong> · {filteredMovements.length} movimentações
              </p>
              <button
                onClick={handleGenerateSelectedPDF}
                disabled={generatingPresentationPdf}
                className="min-h-11 rounded-xl bg-[var(--brand-color)] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-color-strong)] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {generatingPresentationPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : selectedPdfType === 'presentation' ? (
                  <Presentation className="w-4 h-4" />
                ) : (
                  <FileDown className="w-4 h-4" />
                )}
                {selectedPdfType === 'presentation' ? 'Gerar apresentação assinada' : 'Gerar PDF simples'}
              </button>
            </div>
      </BottomSheet>
      {pdfActionDialog}
    </div>
  )
}
