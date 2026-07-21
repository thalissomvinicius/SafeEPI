// responsive: revisado — mobile-first ✓
"use client"

import { useState, useEffect } from "react"
import { ExternalLink, Fingerprint, History, ShieldCheck, Search, Loader2, FileDown, Trash2, AlertTriangle } from "lucide-react"
import { MobileTableCard } from "@/components/ui/MobileTableCard"
import { api } from "@/services/api"
import { DeliveryWithRelations, SignedDocument, ThirdParty } from "@/types/database"
import { generateDeliveryPDF } from "@/utils/pdfGenerator"
import { usePdfActionDialog } from "@/hooks/usePdfActionDialog"
import { formatDeliveryDate, formatDeliveryTime } from "@/lib/dateOnly"
import { useAuth } from "@/contexts/AuthContext"
import { toast } from "@/lib/toast"
import { LoadingState } from "@/components/ui/LoadingState"
import { AccessibleOverlay } from "@/components/ui/AccessibleOverlay"
import { DataLoadError } from "@/components/ui/DataLoadError"
import { fetchImageDataUrl } from "@/utils/imageDataUrl"

type DeliveryScopeFilter = "own" | "third_party" | "all"

const getDeliveryCost = (delivery: DeliveryWithRelations) =>
  Number(delivery.quantity || 0) * Number(delivery.ppe?.cost || 0)

const getThirdPartyDisplayName = (thirdParty?: ThirdParty | null) =>
  thirdParty?.trade_name || thirdParty?.name || "Terceiro sem nome"

export default function HistoryPage() {
  const { user } = useAuth()
  const isMaster = user?.role === "MASTER"
  const hasThirdPartyFeature = Boolean(user)
  const { openPdfDialog, pdfActionDialog } = usePdfActionDialog()
  const [records, setRecords] = useState<DeliveryWithRelations[]>([])
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([])
  const [signedDocuments, setSignedDocuments] = useState<SignedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [openingAssetKey, setOpeningAssetKey] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DeliveryWithRelations | null>(null)
  const [deliveryScopeFilter, setDeliveryScopeFilter] = useState<DeliveryScopeFilter>("own")
  const [selectedThirdPartyIds, setSelectedThirdPartyIds] = useState<string[]>([])

  useEffect(() => {
    async function fetchHistory() {
      try {
        setLoading(true)
        setLoadError(null)
        const [deliveryData, documentData, thirdPartyData] = await Promise.all([
          api.getDeliveries({ signAssets: false }),
          api.getSignedDocuments({ signAssets: false }),
          hasThirdPartyFeature ? api.getThirdParties() : Promise.resolve([] as ThirdParty[]),
        ])
        setRecords(deliveryData)
        setHasMore(deliveryData.length === 500)
        setSignedDocuments(documentData)
        setThirdParties(thirdPartyData)
      } catch (err) {
        console.error("Erro histórico:", err)
        setLoadError(err instanceof Error ? err.message : "Falha ao carregar o historico.")
        toast.error("Falha ao carregar histórico.")
      } finally {
        setLoading(false)
      }
    }
    fetchHistory()
  }, [hasThirdPartyFeature, reloadVersion])

  const loadMoreRecords = async () => {
    try {
      setLoadingMore(true)
      const nextRecords = await api.getDeliveries({ offset: records.length, limit: 500, signAssets: false })
      setRecords((current) => {
        const knownIds = new Set(current.map((record) => record.id))
        return [...current, ...nextRecords.filter((record) => !knownIds.has(record.id))]
      })
      setHasMore(nextRecords.length === 500)
    } catch (error) {
      console.error("Erro ao carregar mais registros:", error)
      toast.error("Falha ao carregar mais registros do historico.")
    } finally {
      setLoadingMore(false)
    }
  }

  const thirdPartyById = new Map(thirdParties.map((thirdParty) => [thirdParty.id, thirdParty]))

  const getDeliveryThirdPartyId = (delivery: DeliveryWithRelations) =>
    delivery.third_party_id ||
    delivery.employee?.third_party_id ||
    delivery.workplace?.third_party_id ||
    null
  const getDeliveryThirdPartyName = (delivery: DeliveryWithRelations) =>
    getDeliveryThirdPartyId(delivery)
      ? getThirdPartyDisplayName(thirdPartyById.get(getDeliveryThirdPartyId(delivery) || ""))
      : "Próprio"
  const activeThirdParties = thirdParties.filter((thirdParty) => thirdParty.active)
  const selectedThirdParties = selectedThirdPartyIds
    .map((id) => thirdParties.find((thirdParty) => thirdParty.id === id))
    .filter((thirdParty): thirdParty is ThirdParty => Boolean(thirdParty))
  const showThirdPartySelector = hasThirdPartyFeature && deliveryScopeFilter !== "own"

  const addSelectedThirdParty = (thirdPartyId: string) => {
    if (!thirdPartyId || selectedThirdPartyIds.includes(thirdPartyId)) return
    setSelectedThirdPartyIds((prev) => [...prev, thirdPartyId])
  }

  const removeSelectedThirdParty = (thirdPartyId: string) => {
    setSelectedThirdPartyIds((prev) => prev.filter((id) => id !== thirdPartyId))
  }

  const handleOpenPrivateAsset = async (key: string, value: string | null | undefined, label: string) => {
    if (!value) {
      toast.error(`${label} não encontrada.`)
      return
    }

    const popup = window.open("about:blank", "_blank")
    if (popup) popup.opener = null

    try {
      setOpeningAssetKey(key)
      const freshUrl = await api.getPrivateAssetUrl(value, "view")
      if (!freshUrl) throw new Error(`Não foi possível gerar o acesso seguro para ${label.toLowerCase()}.`)

      if (popup && !popup.closed) {
        popup.location.replace(freshUrl)
      } else {
        window.open(freshUrl, "_blank", "noopener,noreferrer")
      }
    } catch (error) {
      if (popup && !popup.closed) popup.close()
      console.error(`Erro ao abrir ${label.toLowerCase()}:`, error)
      toast.error(`Não foi possível abrir ${label.toLowerCase()}. Tente novamente.`)
    } finally {
      setOpeningAssetKey(null)
    }
  }

  const handleDownloadPDF = async (rec: DeliveryWithRelations) => {
    if (!rec.signature_url) {
      toast.error("Este registro não possui assinatura digital.")
      return
    }

    try {
      setDownloadingId(rec.id)
      const signedDocument = getSignedDocumentForDelivery(rec.id)

      if (signedDocument?.document_url) {
        const documentUrl = await api.getPrivateAssetUrl(
          signedDocument.storage_path || signedDocument.document_url,
          "download",
          signedDocument.file_name || `Comprovante_${rec.id.slice(0, 8)}.pdf`,
        )
        if (!documentUrl) throw new Error("Nao foi possivel gerar o link seguro do PDF.")
        const archivedResponse = await fetch(documentUrl)
        const archivedBlob = await archivedResponse.blob()
        openPdfDialog(archivedBlob, signedDocument.file_name || `Comprovante_${rec.id.slice(0, 8)}.pdf`, {
          title: "Comprovante arquivado",
          description: "Este e o PDF juridico original salvo no arquivo digital.",
        })
        toast.success("PDF aberto", signedDocument.file_name)
        return
      }
      
      // 1. Converter URL da assinatura para Base64 (necessário para jsPDF)
      const signatureUrl = await api.getPrivateAssetUrl(rec.signature_storage_path || rec.signature_url, "download")
      if (!signatureUrl) throw new Error("Nao foi possivel gerar o link seguro da assinatura.")
      const base64Signature = await fetchImageDataUrl(signatureUrl, {
        required: true,
        label: "a assinatura da entrega",
      })
      if (!base64Signature) throw new Error("Nao foi possivel carregar a assinatura da entrega.")
      const photoBase64 = signedDocument?.photo_evidence_url
        ? await fetchImageDataUrl(
          await api.getPrivateAssetUrl(
             signedDocument.photo_evidence_storage_path || signedDocument.photo_evidence_url,
             "download",
          ) || signedDocument.photo_evidence_url,
          { required: true, label: "a evidência fotográfica da entrega" },
        ) || undefined
        : undefined
      const authMethod = signedDocument?.auth_method === "manual_facial" || rec.auth_method === "manual_facial"
        ? "manual_facial"
        : (rec.signature_url.includes('bio_') || rec.signature_url.includes('emp_') || rec.auth_method === "facial") ? 'facial' : 'manual'

      // 2. Gerar o PDF
      const pdfBlob = await generateDeliveryPDF({
        employeeName: rec.employee?.full_name || "Desconhecido",
        employeeCpf: rec.employee?.cpf || "000.000.000-00",
        employeeRole: rec.employee?.job_title || "Geral",
        workplaceName: rec.workplace?.name || "Sede",
        ppeName: rec.ppe?.name || "N/A",
        ppeCaNumber: rec.ppe?.ca_number || "N/A",
        ppeCaExpiry: rec.ppe?.ca_expiry_date,
        quantity: rec.quantity,
        reason: rec.reason,
        authMethod,
        signatureBase64: base64Signature,
        photoBase64,
        ipAddress: rec.ip_address || "Remoto",
        validationHash: rec.id.slice(0, 8).toUpperCase(),
        deliveryDate: rec.delivery_date,
      })

      // 3. Criar nome de arquivo padronizado: Comprovante_[ID8]_[Nome]_[EPI].pdf
      const shortId = rec.id.slice(0, 8).toUpperCase()
      const safeName = (rec.employee?.full_name || "Comprovante").split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const safePpe = (rec.ppe?.name || "EPI").split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const fileName = `Comprovante_${shortId}_${safeName}_${safePpe}.pdf`

      openPdfDialog(pdfBlob, fileName, {
        title: "Comprovante pronto",
        description: "Visualize o comprovante em uma nova aba ou baixe o PDF completo.",
      })

      toast.success("PDF gerado com sucesso", fileName)
    } catch (err) {
      console.error("Erro ao gerar PDF:", err)
      toast.error("Erro ao processar o arquivo PDF.")
    } finally {
      setDownloadingId(null)
    }
  }

  const getSignedDocumentForDelivery = (deliveryId: string) =>
    signedDocuments.find((document) =>
      document.delivery_id === deliveryId ||
      document.delivery_ids?.includes(deliveryId)
    )

  const handleDeleteDelivery = async (rec: DeliveryWithRelations) => {
    if (!isMaster) {
      toast.error("Somente o usuario MASTER pode excluir registros de entrega.")
      return
    }

    try {
      setDeletingId(rec.id)
      const result = await api.deleteDelivery(rec.id)
      setRecords((prev) => prev.filter((item) => item.id !== rec.id))
      setSignedDocuments((prev) =>
        prev.filter(
          (document) =>
            document.delivery_id !== rec.id &&
            !document.delivery_ids?.includes(rec.id),
        ),
      )
      const restored = Number(result?.restored_quantity || 0)
      toast.success(
        restored > 0
          ? `Entrega excluida. ${restored} unidade(s) devolvida(s) ao estoque.`
          : "Entrega excluida com sucesso.",
      )
      setConfirmDelete(null)
    } catch (err) {
      console.error("Erro ao excluir entrega:", err)
      const message = err instanceof Error ? err.message : "Erro ao excluir entrega."
      toast.error(message)
    } finally {
      setDeletingId(null)
    }
  }

  const filteredRecords = records.filter((rec: DeliveryWithRelations) => {
    const thirdPartyId = getDeliveryThirdPartyId(rec)
    const isThirdPartyDelivery = Boolean(thirdPartyId)
    const matchesThirdPartySelection = selectedThirdPartyIds.length === 0 || Boolean(thirdPartyId && selectedThirdPartyIds.includes(thirdPartyId))
    const matchesDeliveryScope = !hasThirdPartyFeature ||
      deliveryScopeFilter === "all" ||
      (deliveryScopeFilter === "third_party" ? isThirdPartyDelivery && matchesThirdPartySelection : !isThirdPartyDelivery)
    const matchesAllScopeSelection = deliveryScopeFilter !== "all" || !isThirdPartyDelivery || matchesThirdPartySelection
    const thirdPartyName = getDeliveryThirdPartyName(rec).toLowerCase()

    return matchesDeliveryScope && matchesAllScopeSelection && (
      rec.employee?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      thirdPartyName.includes(searchTerm.toLowerCase()) ||
      rec.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getSignedDocumentForDelivery(rec.id)?.sha256_hash.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })

  const thirdPartyTotals = Array.from(filteredRecords.reduce((acc, rec) => {
    const thirdPartyId = getDeliveryThirdPartyId(rec)
    if (!thirdPartyId) return acc
    const current = acc.get(thirdPartyId) || {
      name: getDeliveryThirdPartyName(rec),
      value: 0,
      deliveries: 0,
      items: 0,
    }
    current.value += getDeliveryCost(rec)
    current.deliveries += 1
    current.items += Number(rec.quantity || 0)
    acc.set(thirdPartyId, current)
    return acc
  }, new Map<string, { name: string; value: number; deliveries: number; items: number }>()).entries())
    .map(([id, item]) => ({ id, ...item }))
    .sort((a, b) => b.value - a.value)

  const activeFilterChips = [
    ...(searchTerm.trim() ? [{ label: `Busca: ${searchTerm.trim()}`, onRemove: () => setSearchTerm("") }] : []),
    ...(hasThirdPartyFeature && deliveryScopeFilter !== "own"
      ? [{
        label: deliveryScopeFilter === "third_party" ? "Terceiros" : "Todos vínculos",
        onRemove: () => setDeliveryScopeFilter("own" as DeliveryScopeFilter),
      }]
      : []),
    ...(showThirdPartySelector && selectedThirdParties.length > 0
      ? selectedThirdParties.map((thirdParty) => ({
        label: getThirdPartyDisplayName(thirdParty),
        onRemove: () => removeSelectedThirdParty(thirdParty.id),
      }))
      : []),
  ]

  const getDeliveryBadge = (rec: DeliveryWithRelations, signedDocument?: SignedDocument) => {
    if (signedDocument) return { label: "Arquivado", variant: "border-green-200 bg-green-50 text-green-700" }
    if (rec.signature_url) return { label: "Assinado", variant: "border-amber-200 bg-amber-50 text-amber-700" }
    return { label: "Pendente", variant: "border-slate-200 bg-slate-50 text-slate-500" }
  }

  if (!loading && loadError && records.length === 0) {
    return (
      <DataLoadError
        title="Historico temporariamente indisponivel"
        message={`${loadError} Os registros nao foram considerados inexistentes.`}
        onRetry={() => {
          setLoading(true)
          setReloadVersion((version) => version + 1)
        }}
      />
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-800 flex items-center uppercase tracking-tighter">
            <History className="w-6 h-6 mr-2 text-[#2563EB]" />
            Auditoria SafeEPI • Live
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Consulta direta ao banco de dados Supabase para conformidade NR-06.</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-200 bg-slate-50/50">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative w-full md:max-w-md md:flex-1">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar colaborador ou ID da entrega..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="min-h-11 w-full bg-white border border-slate-200 text-slate-900 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[#2563EB] transition-all"
              />
            </div>
            {hasThirdPartyFeature && (
              <select
                value={deliveryScopeFilter}
                onChange={(event) => setDeliveryScopeFilter(event.target.value as DeliveryScopeFilter)}
                className="min-h-11 w-full md:w-56 bg-white border border-slate-200 text-slate-700 rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest focus:outline-none focus:border-[#2563EB] transition-all"
              >
                <option value="own">Próprios</option>
                <option value="third_party">Terceiros</option>
                <option value="all">Todos vínculos</option>
              </select>
            )}
          </div>
          {showThirdPartySelector && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Terceiros no histórico</p>
                  <p className="mt-0.5 text-xs font-bold text-slate-600">
                    {selectedThirdParties.length === 0 ? "Todos os terceiros cadastrados" : `${selectedThirdParties.length} selecionado(s)`}
                  </p>
                </div>
                {selectedThirdParties.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedThirdPartyIds([])}
                    className="min-h-9 rounded-xl px-3 text-[10px] font-black uppercase tracking-widest text-[#2563EB] hover:bg-blue-50"
                  >
                    Ver todos
                  </button>
                )}
              </div>
              <select
                title="Selecionar terceiro no histórico"
                value=""
                onChange={(event) => addSelectedThirdParty(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-700 outline-none focus:border-[#2563EB]"
              >
                <option value="">Adicionar terceiro...</option>
                {activeThirdParties.map((thirdParty) => (
                  <option key={thirdParty.id} value={thirdParty.id} disabled={selectedThirdPartyIds.includes(thirdParty.id)}>
                    {getThirdPartyDisplayName(thirdParty)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {activeFilterChips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={chip.onRemove}
                  className="min-h-9 rounded-full border border-blue-100 bg-blue-50 px-3 text-sm font-bold text-[#2563EB]"
                  aria-label={`Remover filtro ${chip.label}`}
                >
                  {chip.label} ×
                </button>
              ))}
            </div>
          )}
          {showThirdPartySelector && (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {thirdPartyTotals.map((thirdParty) => (
                <div key={thirdParty.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="truncate text-sm font-black uppercase tracking-tight text-slate-800" title={thirdParty.name}>{thirdParty.name}</p>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Valor no filtro</p>
                      <p className="mt-1 text-lg font-black text-emerald-700">
                        R$ {thirdParty.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="text-right text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <p>{thirdParty.deliveries} registro(s)</p>
                      <p>{thirdParty.items} item(ns)</p>
                    </div>
                  </div>
                </div>
              ))}
              {thirdPartyTotals.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400 md:col-span-2 xl:col-span-3">
                  Nenhum histórico de terceiro encontrado no filtro atual.
                </div>
              )}
            </div>
          )}
        </div>
        
        <div className="min-h-[300px] flex flex-col overflow-x-hidden md:overflow-x-auto md:overscroll-x-contain">
          {loading ? (
            <LoadingState
              variant="panel"
              label="Acessando arquivo digital"
              detail="Carregando historico, PDFs auditados e filtros vinculados."
            />
          ) : (
            <>
            <div className="grid grid-cols-1 gap-4 bg-slate-50/60 p-4 md:hidden">
              {filteredRecords.map((rec: DeliveryWithRelations) => {
                const signedDocument = getSignedDocumentForDelivery(rec.id)
                return (
                  <MobileTableCard
                    key={rec.id}
                    title={rec.employee?.full_name || "Colaborador nao informado"}
                    subtitle={rec.ppe?.name || "EPI nao informado"}
                    badge={getDeliveryBadge(rec, signedDocument)}
                    expandable
                    fields={[
                      { label: "Data", value: `${formatDeliveryDate(rec.delivery_date)} ${formatDeliveryTime(rec.delivery_date)}` },
                      { label: "Protocolo", value: `#${rec.id.slice(0, 8)}` },
                      { label: "Quantidade", value: String(rec.quantity) },
                      { label: "CA", value: rec.ppe?.ca_number || "-" },
                      { label: "Tomador", value: getDeliveryThirdPartyId(rec) ? getDeliveryThirdPartyName(rec) : "Próprio" },
                      { label: "Valor", value: `R$ ${getDeliveryCost(rec).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                      { label: "Setor", value: rec.employee?.job_title || rec.workplace?.name || "-" },
                      { label: "Observações", value: rec.reason || "-" },
                      { label: "Quem registrou", value: "Sistema SafeEPI" },
                    ]}
                    actions={
                      <div className="flex w-full gap-2">
                        <button
                          onClick={() => handleDownloadPDF(rec)}
                          disabled={downloadingId === rec.id}
                          className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-[10px] font-black uppercase tracking-widest text-[#2563EB] disabled:opacity-30"
                        >
                          {downloadingId === rec.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}
                          PDF
                        </button>
                        {isMaster && (
                          <button
                            onClick={() => setConfirmDelete(rec)}
                            disabled={deletingId === rec.id}
                            className="flex min-h-11 w-12 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-600 disabled:opacity-30"
                            aria-label="Excluir registro"
                          >
                            {deletingId === rec.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    }
                  />
                )
              })}
              {filteredRecords.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-400 italic font-medium">
                  Nenhum registro de entrega encontrado no histórico.
                </div>
              )}
            </div>
            <table className="hidden min-w-[1220px] w-full whitespace-nowrap text-left text-sm md:table xl:min-w-0">
                <thead className="whitespace-nowrap text-[10px] text-slate-400 bg-white uppercase tracking-[0.2em] border-b border-slate-100 font-black">
                <tr>
                    <th className="px-4 py-5 lg:px-5">Protocolo</th>
                    <th className="px-4 py-5 lg:px-5">Colaborador</th>
                    <th className="px-4 py-5 lg:px-5">Tomador</th>
                    <th className="px-4 py-5 lg:px-5">EPI / CA</th>
                    <th className="px-4 py-5 lg:px-5">Valor</th>
                    <th className="px-4 py-5 lg:px-5">Data da Entrega</th>
                    <th className="px-4 py-5 lg:px-5">Arquivo Juridico</th>
                    <th className="hidden px-4 py-5 lg:px-5 xl:table-cell">Hash SHA-256</th>
                    <th className="sticky right-0 z-20 min-w-[118px] bg-white px-4 py-5 text-right shadow-[-16px_0_22px_-22px_rgba(15,23,42,0.55)]">Ação</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                {filteredRecords.map((rec: DeliveryWithRelations) => {
                  const signedDocument = getSignedDocumentForDelivery(rec.id)

                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-4 py-5 font-mono text-[10px] text-slate-400 lg:px-5">#{rec.id.slice(0, 8)}</td>
                    <td className="px-4 py-5 font-bold text-slate-800 lg:px-5">{rec.employee?.full_name}</td>
                    <td className="px-4 py-5 text-xs font-black uppercase tracking-tight text-slate-500 lg:px-5">
                      {getDeliveryThirdPartyId(rec) ? getDeliveryThirdPartyName(rec) : "Próprio"}
                    </td>
                    <td className="px-4 py-5 text-slate-600 font-medium lg:px-5">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span>{rec.ppe?.name}</span>
                          <span className="text-[10px] text-slate-400 font-bold uppercase">CA {rec.ppe?.ca_number}</span>
                        </div>
                    </td>
                    <td className="px-4 py-5 text-xs font-black text-emerald-700 lg:px-5">
                      R$ {getDeliveryCost(rec).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-5 text-slate-400 text-xs font-bold uppercase lg:px-5">
                        <span className="whitespace-nowrap">{formatDeliveryDate(rec.delivery_date)} · {formatDeliveryTime(rec.delivery_date)}</span>
                    </td>
                    <td className="px-4 py-5 lg:px-5">
                        {signedDocument ? (
                             <button
                                type="button"
                                onClick={() => void handleOpenPrivateAsset(
                                  `document:${signedDocument.id}`,
                                  signedDocument.storage_path || signedDocument.document_url,
                                  "Documento arquivado",
                                )}
                                disabled={openingAssetKey === `document:${signedDocument.id}`}
                                aria-label={`Abrir documento arquivado de ${rec.employee?.full_name || "colaborador"}`}
                                className="flex w-fit items-center whitespace-nowrap rounded border border-green-100 bg-green-50 px-2 py-1 text-[10px] font-bold text-green-700 transition-colors hover:bg-green-100 disabled:opacity-60"
                             >
                                {openingAssetKey === `document:${signedDocument.id}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
                                Arquivado
                                <ExternalLink className="w-3 h-3 ml-1" />
                             </button>
                        ) : rec.signature_url ? (
                             <button
                                type="button"
                                onClick={() => void handleOpenPrivateAsset(
                                  `signature:${rec.id}`,
                                  rec.signature_storage_path || rec.signature_url,
                                  "Assinatura",
                                )}
                                disabled={openingAssetKey === `signature:${rec.id}`}
                                aria-label={`Abrir somente a assinatura de ${rec.employee?.full_name || "colaborador"}`}
                                className="flex w-fit items-center whitespace-nowrap rounded border border-amber-100 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-600 transition-colors hover:bg-amber-100 disabled:opacity-60"
                             >
                                {openingAssetKey === `signature:${rec.id}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
                                Só assinatura
                             </button>
                        ) : (
                            <span className="text-[10px] text-amber-500 font-bold bg-amber-50 px-2 py-1 rounded border border-amber-100 w-fit">Pendente</span>
                        )}
                    </td>
                    <td className="hidden px-4 py-5 lg:px-5 xl:table-cell">
                      {signedDocument ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-[10px] font-black text-slate-600 uppercase tracking-widest">
                            <Fingerprint className="w-3.5 h-3.5 text-[#2563EB]" />
                            {signedDocument.sha256_hash.slice(0, 12)}...
                          </div>
                          <p className="text-[9px] font-bold text-slate-400 uppercase">
                            {new Date(signedDocument.created_at).toLocaleString("pt-BR")}
                          </p>
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold text-slate-300 uppercase">Sem arquivo</span>
                      )}
                    </td>
                    <td className="sticky right-0 z-10 bg-white px-3 py-5 text-right shadow-[-16px_0_22px_-22px_rgba(15,23,42,0.55)] transition-colors group-hover:bg-slate-50/80">
                        <div className="flex min-w-[98px] items-center justify-end gap-1">
                          <button
                            onClick={() => handleDownloadPDF(rec)}
                            disabled={downloadingId === rec.id}
                            className="flex min-h-10 min-w-[64px] items-center justify-center rounded-xl border border-blue-100 bg-blue-50 px-3 text-[10px] font-black uppercase tracking-widest text-[#2563EB] transition-all hover:bg-blue-100 disabled:opacity-30"
                          >
                              {downloadingId === rec.id ? (
                                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                              ) : (
                                <FileDown className="w-4 h-4 mr-1" />
                              )}
                              PDF
                          </button>
                          {isMaster && (
                            <button
                              onClick={() => setConfirmDelete(rec)}
                              disabled={deletingId === rec.id}
                              title="Excluir registro de entrega (Master)"
                              className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-600 transition-all hover:bg-red-100 disabled:opacity-30"
                            >
                              {deletingId === rec.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>
                    </td>
                    </tr>
                  )
                })}
                {filteredRecords.length === 0 && (
                    <tr>
                        <td colSpan={9} className="px-6 py-20 text-center text-slate-400 italic font-medium">
                            Nenhum registro de entrega encontrado no histórico.
                        </td>
                    </tr>
                )}
                </tbody>
            </table>
            </>
          )}
        </div>
        {hasMore && !loading && (
          <div className="border-t border-slate-100 bg-slate-50 p-4 text-center">
            <button
              type="button"
              onClick={() => void loadMoreRecords()}
              disabled={loadingMore}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-xs font-black uppercase tracking-widest text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-[#2563EB] disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Carregar mais 500 registros"}
            </button>
          </div>
        )}
      </div>
      {pdfActionDialog}

      {confirmDelete && isMaster && (
        <AccessibleOverlay
          label="Invalidar registro de entrega"
          onClose={() => {
            if (deletingId !== confirmDelete.id) setConfirmDelete(null)
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={(event) => {
            if (event.target === event.currentTarget && deletingId !== confirmDelete.id) {
              setConfirmDelete(null)
            }
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-red-50/60 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-800 uppercase tracking-tight">
                  Invalidar registro de entrega
                </h2>
                <p className="text-xs text-red-700 font-bold mt-1">
                  Acao restrita ao usuario MASTER e registrada para auditoria.
                </p>
              </div>
            </div>
            <div className="p-5 space-y-3 text-sm text-slate-700">
              <p className="font-medium">
                Confirma a invalidacao desta entrega? O saldo consumido sera estornado automaticamente.
                A entrega, o documento assinado e a trilha de auditoria serao preservados como evidencia.
              </p>
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-1 text-xs">
                <p>
                  <span className="font-black uppercase tracking-widest text-slate-400 mr-2">
                    Protocolo
                  </span>
                  <span className="font-mono">#{confirmDelete.id.slice(0, 8)}</span>
                </p>
                <p>
                  <span className="font-black uppercase tracking-widest text-slate-400 mr-2">
                    Colaborador
                  </span>
                  {confirmDelete.employee?.full_name || "-"}
                </p>
                <p>
                  <span className="font-black uppercase tracking-widest text-slate-400 mr-2">EPI</span>
                  {confirmDelete.ppe?.name || "-"} (CA {confirmDelete.ppe?.ca_number || "-"})
                </p>
                <p>
                  <span className="font-black uppercase tracking-widest text-slate-400 mr-2">
                    Quantidade
                  </span>
                  {confirmDelete.quantity}
                </p>
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deletingId === confirmDelete.id}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-white font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteDelivery(confirmDelete)}
                disabled={deletingId === confirmDelete.id}
                className="px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 font-black text-[11px] uppercase tracking-widest flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {deletingId === confirmDelete.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Invalidar agora
              </button>
            </div>
          </div>
        </AccessibleOverlay>
      )}
    </div>
  )
}
