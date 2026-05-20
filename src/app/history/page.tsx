// responsive: revisado — mobile-first ✓
"use client"

import { useState, useEffect } from "react"
import { ExternalLink, Fingerprint, History, ShieldCheck, Search, Loader2, FileDown, Trash2, AlertTriangle } from "lucide-react"
import { MobileTableCard } from "@/components/ui/MobileTableCard"
import { api } from "@/services/api"
import { DeliveryWithRelations, Employee, SignedDocument, Workplace } from "@/types/database"
import { generateDeliveryPDF } from "@/utils/pdfGenerator"
import { usePdfActionDialog } from "@/hooks/usePdfActionDialog"
import { formatDeliveryDate, formatDeliveryTime } from "@/lib/dateOnly"
import { useAuth } from "@/contexts/AuthContext"
import { toast } from "sonner"

type DeliveryScopeFilter = "own" | "third_party" | "all"

export default function HistoryPage() {
  const { user } = useAuth()
  const isMaster = user?.role === "MASTER"
  const hasThirdPartyFeature = Boolean(user)
  const { openPdfDialog, pdfActionDialog } = usePdfActionDialog()
  const [records, setRecords] = useState<DeliveryWithRelations[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [signedDocuments, setSignedDocuments] = useState<SignedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DeliveryWithRelations | null>(null)
  const [deliveryScopeFilter, setDeliveryScopeFilter] = useState<DeliveryScopeFilter>("own")

  useEffect(() => {
    async function fetchHistory() {
      try {
        setLoading(true)
        const [deliveryData, documentData, employeeData, workplaceData] = await Promise.all([
          api.getDeliveries(),
          api.getSignedDocuments(),
          hasThirdPartyFeature ? api.getEmployees() : Promise.resolve([] as Employee[]),
          hasThirdPartyFeature ? api.getWorkplaces() : Promise.resolve([] as Workplace[]),
        ])
        setRecords(deliveryData)
        setSignedDocuments(documentData)
        setEmployees(employeeData)
        setWorkplaces(workplaceData)
      } catch (err) {
        console.error("Erro histórico:", err)
        toast.error("Falha ao carregar histórico.")
      } finally {
        setLoading(false)
      }
    }
    fetchHistory()
  }, [hasThirdPartyFeature])

  const employeeThirdPartyById = new Map(employees.map((employee) => [employee.id, employee.third_party_id || null]))
  const workplaceThirdPartyById = new Map(workplaces.map((workplace) => [workplace.id, workplace.third_party_id || null]))

  const getDeliveryThirdPartyId = (delivery: DeliveryWithRelations) =>
    delivery.third_party_id ||
    delivery.employee?.third_party_id ||
    delivery.workplace?.third_party_id ||
    employeeThirdPartyById.get(delivery.employee_id) ||
    workplaceThirdPartyById.get(delivery.workplace_id || "") ||
    null

  const urlToBase64 = async (url: string) => {
    const response = await fetch(url)
    const blob = await response.blob()
    return new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    })
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
        toast.success(`PDF aberto: ${signedDocument.file_name}`)
        return
      }
      
      // 1. Converter URL da assinatura para Base64 (necessário para jsPDF)
      const signatureUrl = await api.getPrivateAssetUrl(rec.signature_storage_path || rec.signature_url, "download")
      const base64Signature = await urlToBase64(signatureUrl || rec.signature_url)
      const photoBase64 = signedDocument?.photo_evidence_url
        ? await urlToBase64(
          await api.getPrivateAssetUrl(
            signedDocument.photo_evidence_storage_path || signedDocument.photo_evidence_url,
            "download",
          ) || signedDocument.photo_evidence_url,
        ).catch(() => undefined)
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

      toast.success(`PDF gerado: ${fileName}`)
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
    const isThirdPartyDelivery = Boolean(getDeliveryThirdPartyId(rec))
    const matchesDeliveryScope = !hasThirdPartyFeature ||
      deliveryScopeFilter === "all" ||
      (deliveryScopeFilter === "third_party" ? isThirdPartyDelivery : !isThirdPartyDelivery)

    return matchesDeliveryScope && (
      rec.employee?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rec.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getSignedDocumentForDelivery(rec.id)?.sha256_hash.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })

  const activeFilterChips = [
    ...(searchTerm.trim() ? [{ label: `Busca: ${searchTerm.trim()}`, onRemove: () => setSearchTerm("") }] : []),
    ...(hasThirdPartyFeature && deliveryScopeFilter !== "own"
      ? [{
        label: deliveryScopeFilter === "third_party" ? "Terceiros" : "Todos vínculos",
        onRemove: () => setDeliveryScopeFilter("own" as DeliveryScopeFilter),
      }]
      : []),
  ]

  const getDeliveryBadge = (rec: DeliveryWithRelations, signedDocument?: SignedDocument) => {
    if (signedDocument) return { label: "Arquivado", variant: "border-green-200 bg-green-50 text-green-700" }
    if (rec.signature_url) return { label: "Assinado", variant: "border-amber-200 bg-amber-50 text-amber-700" }
    return { label: "Pendente", variant: "border-slate-200 bg-slate-50 text-slate-500" }
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
            <button
              type="button"
              className="min-h-11 w-full rounded-xl bg-[#2563EB] px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-sm shadow-blue-900/10 md:w-auto"
            >
              Filtrar
            </button>
          </div>
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
        </div>
        
        <div className="min-h-[300px] flex flex-col md:overflow-x-auto">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-[#2563EB] mb-2" />
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Acessando Arquivo Digital...</p>
             </div>
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
            <table className="hidden w-full text-sm text-left md:table">
                <thead className="text-[10px] text-slate-400 bg-white uppercase tracking-[0.2em] border-b border-slate-100 font-black">
                <tr>
                    <th className="px-6 py-5">Protocolo</th>
                    <th className="px-6 py-5">Colaborador</th>
                    <th className="px-6 py-5">EPI / CA</th>
                    <th className="px-6 py-5">Data da Entrega</th>
                    <th className="px-6 py-5">Arquivo Juridico</th>
                    <th className="px-6 py-5">Hash SHA-256</th>
                    <th className="px-6 py-5 text-right">Ação</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                {filteredRecords.map((rec: DeliveryWithRelations) => {
                  const signedDocument = getSignedDocumentForDelivery(rec.id)

                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-5 font-mono text-[10px] text-slate-400">#{rec.id.slice(0, 8)}</td>
                    <td className="px-6 py-5 font-bold text-slate-800">{rec.employee?.full_name}</td>
                    <td className="px-6 py-5 text-slate-600 font-medium">
                        {rec.ppe?.name} <br/>
                        <span className="text-[10px] text-slate-400 font-bold uppercase">CA {rec.ppe?.ca_number}</span>
                    </td>
                    <td className="px-6 py-5 text-slate-400 text-xs font-bold uppercase">
                        {formatDeliveryDate(rec.delivery_date)} <br/>
                        {formatDeliveryTime(rec.delivery_date)}
                    </td>
                    <td className="px-6 py-5">
                        {signedDocument ? (
                             <a
                                href={signedDocument.document_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center text-[10px] text-green-700 font-bold bg-green-50 px-2 py-1 rounded border border-green-100 hover:bg-green-100 transition-colors w-fit"
                             >
                                <ShieldCheck className="w-3 h-3 mr-1" />
                                Arquivado
                                <ExternalLink className="w-3 h-3 ml-1" />
                             </a>
                        ) : rec.signature_url ? (
                             <a 
                                href={rec.signature_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex items-center text-[10px] text-amber-600 font-bold bg-amber-50 px-2 py-1 rounded border border-amber-100 hover:bg-amber-100 transition-colors w-fit"
                             >
                                <ShieldCheck className="w-3 h-3 mr-1" />
                                So assinatura
                             </a>
                        ) : (
                            <span className="text-[10px] text-amber-500 font-bold bg-amber-50 px-2 py-1 rounded border border-amber-100 w-fit">Pendente</span>
                        )}
                    </td>
                    <td className="px-6 py-5">
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
                    <td className="px-6 py-5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleDownloadPDF(rec)}
                            disabled={downloadingId === rec.id}
                            className="text-[#2563EB] hover:bg-blue-50 font-black text-[10px] uppercase tracking-widest flex items-center justify-end p-2 rounded transition-all group-hover:underline disabled:opacity-30"
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
                              className="text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 font-black text-[10px] uppercase tracking-widest flex items-center justify-center p-2 rounded transition-all disabled:opacity-30"
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
                        <td colSpan={7} className="px-6 py-20 text-center text-slate-400 italic font-medium">
                            Nenhum registro de entrega encontrado no histórico.
                        </td>
                    </tr>
                )}
                </tbody>
            </table>
            </>
          )}
        </div>
      </div>
      {pdfActionDialog}

      {confirmDelete && isMaster && (
        <div
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
                  Excluir registro de entrega
                </h2>
                <p className="text-xs text-red-700 font-bold mt-1">
                  Acao restrita ao usuario MASTER. Esta operacao nao pode ser desfeita.
                </p>
              </div>
            </div>
            <div className="p-5 space-y-3 text-sm text-slate-700">
              <p className="font-medium">
                Confirma a exclusao desta entrega? O EPI sera devolvido ao estoque automaticamente
                e o arquivo juridico associado sera removido.
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
                Excluir agora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
