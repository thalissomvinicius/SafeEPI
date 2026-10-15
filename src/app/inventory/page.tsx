// responsive: revisado — mobile-first ✓
"use client"

import { useState, useEffect, useRef } from "react"
import { Package, Plus, History, Search, ArrowUpCircle, ArrowDownCircle, Settings2, X, FileDown, FileSpreadsheet } from "lucide-react"
import { api } from "@/services/api"
import { PPE, StockMovement } from "@/types/database"
import { MobileTableCard } from "@/components/ui/MobileTableCard"
import { Skeleton } from "@/components/ui/Skeleton"
import { DataLoadError } from "@/components/ui/DataLoadError"
import { useAuth } from "@/contexts/AuthContext"
import { toast } from "@/lib/toast"
import { usePdfActionDialog } from "@/hooks/usePdfActionDialog"
import { generateInventoryStockReportPDF } from "@/utils/pdfGenerator"
import { exportInventoryStockToExcel } from "@/utils/excelExporter"
import { AccessibleOverlay } from "@/components/ui/AccessibleOverlay"
import { LOW_STOCK_THRESHOLD, isValidStockQuantity } from "@/lib/stockPolicy"
import { formatInventoryExpiry, formatInventoryMovementDate } from "@/lib/inventoryDisplay"
import { Button } from "@/components/ui/button"

export default function InventoryPage() {
  const { user } = useAuth()
  const { openPdfDialog, pdfActionDialog } = usePdfActionDialog()
  const [ppes, setPpes] = useState<PPE[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [hasMoreMovements, setHasMoreMovements] = useState(false)
  const [movementTotal, setMovementTotal] = useState<number | null>(null)
  const [loadingMoreMovements, setLoadingMoreMovements] = useState(false)
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null)
  const savingRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const exportingRef = useRef(false)

  // Form State
  const [formData, setFormData] = useState({
    ppe_id: "",
    quantity: 1,
    type: "ENTRADA" as "ENTRADA" | "SAIDA" | "AJUSTE",
    motive: "Compra / Reposição de Estoque"
  })

  const loadData = async () => {
    const [ppeResult, movementResult] = await Promise.allSettled([
      api.getPpes(),
      api.getStockMovementsPage({ limit: 100, offset: 0 }),
    ])
    if (ppeResult.status === "fulfilled") {
      const ppeData = ppeResult.value
      setPpes(ppeData)
      setLoadError(null)
      setFormData(prev => ({ ...prev, ppe_id: ppeData.some(ppe => ppe.id === prev.ppe_id) ? prev.ppe_id : ppeData[0]?.id || "" }))
    } else {
      console.error("Erro ao carregar saldos:", ppeResult.reason)
      setLoadError("Não foi possível atualizar os saldos. Os dados da última consulta foram mantidos.")
    }
    if (movementResult.status === "fulfilled") {
      const page = movementResult.value
      setMovements(page.movements)
      setHasMoreMovements(page.hasMore)
      setMovementTotal(page.total ?? null)
      setHistoryError(null)
    } else {
      console.error("Erro ao carregar histórico:", movementResult.reason)
      setHistoryError("Não foi possível atualizar o histórico de estoque. Os registros já carregados foram mantidos.")
    }
    setLoading(false)
    return ppeResult.status === "fulfilled" && movementResult.status === "fulfilled"
  }

  const loadMoreMovements = async () => {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    try {
      setLoadingMoreMovements(true)
      const page = await api.getStockMovementsPage({ limit: 100, offset: movements.length })
      setMovements((current) => Array.from(new Map([...current, ...page.movements].map((movement) => [movement.id, movement])).values()))
      setHasMoreMovements(page.hasMore)
      setMovementTotal(page.total ?? null)
    } catch {
      toast.error("Não foi possível carregar a próxima página. O histórico anterior foi mantido.")
    } finally {
      loadingMoreRef.current = false
      setLoadingMoreMovements(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault()
    if (savingRef.current) return
    if (!formData.ppe_id || !isValidStockQuantity(formData.type, formData.quantity)) {
      toast.error("Informe uma quantidade inteira. Saldo zero é permitido somente para ajuste de inventário.")
      return
    }

    try {
      savingRef.current = true
      setIsSaving(true)
      await api.addStockMovement({
        ...formData,
        created_by_id: user?.id ?? null,
        created_by_name: user?.user_metadata?.full_name || user?.email || 'Sistema'
      })
      const refreshed = await loadData()
      setIsModalOpen(false)
      setFormData(prev => ({ ...prev, quantity: 1, motive: "Compra / Reposição de Estoque" }))
      if (refreshed) toast.success("Movimentação de estoque registrada com sucesso.")
      else toast.warning("Movimentação registrada. A atualização da tela falhou; tente atualizar os dados, sem repetir a movimentação.")
    } catch (error) {
      console.error('[Estoque] ERRO ao salvar movimentação:', error)
      toast.error(error instanceof Error ? error.message : "Erro ao aplicar ajuste de estoque.")
    } finally {
      savingRef.current = false
      setIsSaving(false)
      setLoading(false)
    }
  }

  const filteredPpes = ppes.filter(p => (p.name || "").toLowerCase().includes(searchTerm.toLowerCase()))
  const stockReportPpes = filteredPpes.filter(ppe => Number(ppe.current_stock || 0) > 0)

  if (!loading && loadError && ppes.length === 0 && movements.length === 0) {
    return (
      <DataLoadError
        title="Estoque temporariamente indisponível"
        message="Não foi possível consultar o estoque. Os saldos não foram substituídos por zero."
        onRetry={() => {
          setLoading(true)
          void loadData()
        }}
      />
    )
  }
  const recentMovements = movements.slice(0, 5)

  const getStockBadge = (stock: number) => {
    if (stock <= 0) return { label: "Zerado", variant: "border-red-200 bg-red-50 text-red-700" }
    if (stock <= LOW_STOCK_THRESHOLD) return { label: `${stock} baixo`, variant: "border-amber-200 bg-amber-50 text-amber-700" }
    return { label: `${stock} ok`, variant: "border-green-200 bg-green-50 text-green-700" }
  }

  const getRecentMovementsForPpe = (ppeId: string) =>
    movements
      .filter((movement) => movement.ppe_id === ppeId)
      .slice(0, 3)
      .map((movement) => `${movement.type} ${movement.quantity}`)
      .join(", ") || (historyError ? "Histórico indisponível" : "Sem movimentações recentes")

  const getStockReportData = () => stockReportPpes.length > 0 ? stockReportPpes : filteredPpes

  const getStockFilterLabel = () => {
    const count = getStockReportData().length
    if (searchTerm.trim()) return `Busca: ${searchTerm.trim()} - ${count} item(ns)`
    return `Itens com saldo em estoque - ${count} item(ns)`
  }

  const handleExportInventoryPDF = async () => {
    if (exportingRef.current) return
    const reportData = getStockReportData()
    if (reportData.length === 0) {
      toast.error("Nenhum item de estoque para gerar relatório.")
      return
    }

    exportingRef.current = true
    setExporting("pdf")
    try {
      // Let the pending button paint before PDF generation uses the main thread.
      await new Promise<void>(resolve => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)))
      const blob = generateInventoryStockReportPDF({ ppes: reportData, filterLabel: getStockFilterLabel() })
      openPdfDialog(blob, `Relatorio_Estoque_${new Date().toISOString().slice(0, 10)}.pdf`, {
        title: "Relatório de estoque pronto",
        description: "Escolha se deseja abrir o PDF em uma nova aba ou baixar o arquivo.",
      })
    } catch {
      toast.error("Não foi possível gerar o relatório de estoque. Tente novamente.")
    } finally {
      exportingRef.current = false
      setExporting(null)
    }
  }

  const handleExportInventoryExcel = async () => {
    if (exportingRef.current) return
    const reportData = getStockReportData()
    if (reportData.length === 0) {
      toast.error("Nenhum item de estoque para exportar.")
      return
    }

    exportingRef.current = true
    setExporting("excel")
    try {
      await exportInventoryStockToExcel(reportData, getStockFilterLabel())
    } catch {
      toast.error("Não foi possível exportar o estoque. Tente novamente.")
    } finally {
      exportingRef.current = false
      setExporting(null)
    }
  }

  const renderMovementItem = (movement: StockMovement) => (
    <div key={movement.id} className="flex gap-4 items-start group">
      <div className={`p-2 rounded-xl shrink-0 ${movement.type === 'ENTRADA' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-blue-300'}`}>
        {movement.type === 'ENTRADA' ? <ArrowUpCircle className="w-4 h-4" /> : <ArrowDownCircle className="w-4 h-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex justify-between items-start gap-3">
          <p className="text-sm font-semibold text-white break-words">{movement.ppe?.name || "EPI removido"}{movement.ppe?.active === false ? " · Inativo" : ""}</p>
          <span className={`text-xs font-black italic ${movement.type === 'ENTRADA' ? 'text-green-400' : 'text-blue-300'}`}>
            {movement.type === 'AJUSTE' ? '= ' : movement.type === 'ENTRADA' ? '+' : '-'}{Math.abs(movement.quantity)}
          </span>
        </div>
        <p className="text-xs text-slate-300 leading-5">{movement.motive}</p>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <p className="text-xs text-slate-400">
            {formatInventoryMovementDate(movement.created_at)}
          </p>
          {movement.created_by_name && (
            <span className="text-xs text-slate-400">· {movement.created_by_name}</span>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-24">
      {/* Header */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
             <span className="text-xs font-semibold text-slate-500">Almoxarifado</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 flex items-center">
            <Package className="w-8 h-8 mr-3 shrink-0 text-[#2563EB]" />
            Controle de Estoque
          </h1>
          <p className="text-slate-500 text-sm mt-2 leading-6">Saldo disponível e histórico de entradas, saídas e ajustes.</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex sm:flex-wrap">
          <Button
            type="button"
            onClick={handleExportInventoryExcel}
            variant="outline"
            loading={exporting === "excel"}
            loadingText="Exportando…"
            disabled={loading || isSaving || Boolean(loadError) || exporting !== null || filteredPpes.length === 0}
            className="min-h-11 w-full sm:w-auto border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 rounded-xl flex items-center justify-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            Excel
          </Button>
          <Button
            type="button"
            onClick={handleExportInventoryPDF}
            variant="outline"
            loading={exporting === "pdf"}
            loadingText="Gerando PDF…"
            disabled={loading || isSaving || Boolean(loadError) || exporting !== null || filteredPpes.length === 0}
            className="min-h-11 w-full sm:w-auto border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 rounded-xl flex items-center justify-center gap-2"
          >
            <FileDown className="w-4 h-4" />
            PDF
          </Button>
          <Button
            type="button"
            onClick={() => setIsModalOpen(true)}
            disabled={loading || isSaving || Boolean(loadError) || ppes.length === 0}
            title="Abrir formulário de entrada de estoque"
            className="col-span-2 min-h-11 w-full sm:w-auto bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-5 py-3 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            Movimentar estoque
          </Button>
        </div>
      </div>

      {(loadError || historyError) && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1 text-sm leading-6 text-amber-950">
            {loadError && <p>{loadError}</p>}
            {historyError && <p>{historyError}</p>}
          </div>
          <Button
            type="button"
            variant="outline"
            loading={loading}
            loadingText="Atualizando…"
            disabled={isSaving || loadingMoreMovements}
            onClick={() => { setLoading(true); void loadData() }}
          >Tentar novamente</Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Lado Esquerdo: Saldo Atual */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden min-h-[500px]">
             <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <h3 className="font-black text-slate-800 uppercase tracking-tighter text-sm flex items-center gap-2">
                    <Settings2 className="w-4 h-4 text-[#2563EB]" />
                    Saldos Disponíveis
                </h3>
                <div className="relative w-full md:w-48">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                        type="text" 
                        placeholder="Buscar EPI..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="min-h-11 w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-[#2563EB]"
                    />
                </div>
             </div>
             
             {loading ? (
                <div className="w-full space-y-4 p-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="flex items-center space-x-4 py-4 border-b border-slate-50">
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-1/3" />
                                <Skeleton className="h-3 w-1/4" />
                            </div>
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-4 w-24 rounded-full" />
                        </div>
                    ))}
                </div>
             ) : (
                <>
                <div className="grid grid-cols-1 gap-4 bg-slate-50/60 p-4 md:hidden">
                    {filteredPpes.map(ppe => (
                        <MobileTableCard
                            key={ppe.id}
                            title={ppe.name}
                            badge={getStockBadge(Number(ppe.current_stock || 0))}
                            expandable
                            fields={[
                                { label: "CA", value: ppe.ca_number || "-" },
                                { label: "Saldo", value: <span className="text-lg font-black text-slate-900">{ppe.current_stock}</span> },
                                { label: "Validade CA", value: formatInventoryExpiry(ppe.ca_expiry_date) },
                                { label: "Categoria", value: "EPI" },
                                { label: "Movimentações", value: getRecentMovementsForPpe(ppe.id) },
                            ]}
                        />
                    ))}
                    {filteredPpes.length === 0 && !loadError && (
                        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-400 italic font-medium">
                            Nenhum EPI encontrado.
                        </div>
                    )}
                </div>
                <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm text-left">
                        <thead className="text-[10px] text-slate-400 uppercase tracking-widest font-black border-b border-slate-50">
                            <tr>
                                <th className="px-4 md:px-6 py-4">Equipamento (EPI)</th>
                                <th className="hidden md:table-cell px-4 md:px-6 py-4">Unidade de Medida</th>
                                <th className="px-4 md:px-6 py-4 text-center">Saldo</th>
                                <th className="px-4 md:px-6 py-4 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filteredPpes.map(ppe => (
                                <tr key={ppe.id} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="px-4 md:px-6 py-5">
                                        <p className="font-bold text-slate-800 uppercase tracking-tight text-xs sm:text-sm">{ppe.name}</p>
                                        <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium">CA: {ppe.ca_number}</p>
                                    </td>
                                    <td className="hidden md:table-cell px-4 md:px-6 py-5 text-slate-400 font-medium italic text-xs">Unidade (Und)</td>
                                    <td className="px-4 md:px-6 py-5 text-center">
                                        <span className={`text-lg sm:text-xl font-semibold tabular-nums ${ppe.current_stock > LOW_STOCK_THRESHOLD ? 'text-slate-800' : 'text-amber-700'}`}>
                                            {ppe.current_stock}
                                        </span>
                                    </td>
                                    <td className="px-4 md:px-6 py-5 text-center">
                                        {ppe.current_stock <= LOW_STOCK_THRESHOLD ? (
                                            <span className="px-2 py-1 bg-amber-50 text-amber-800 text-xs font-semibold rounded border border-amber-100">Estoque baixo</span>
                                        ) : (
                                            <span className="px-2 py-1 bg-green-50 text-green-700 text-xs font-semibold rounded border border-green-100">OK</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {filteredPpes.length === 0 && !loadError && (
                              <tr><td colSpan={4} className="px-6 py-12 text-center text-sm text-slate-500">Nenhum EPI encontrado.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                </>
             )}
          </div>
          <Button
            type="button"
            onClick={() => setIsHistoryModalOpen(true)}
            disabled={loading || movements.length === 0}
            className="w-full bg-slate-900 text-white hover:bg-slate-800 lg:hidden"
          ><History className="h-4 w-4" />Ver histórico de estoque</Button>
        </div>

        {/* Lado Direito: Histórico de Movimentações */}
        <div className="hidden space-y-6 lg:sticky lg:top-6 lg:self-start lg:block">
           <div className="bg-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl relative overflow-hidden min-h-[420px] lg:max-h-[calc(100dvh-8rem)] flex flex-col">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#2563EB]/20 rounded-full blur-3xl -mr-16 -mt-16"></div>
              <h3 className="font-black text-white uppercase tracking-tighter text-sm flex items-center gap-2 mb-6 relative z-10 shrink-0">
                 <History className="w-5 h-5 text-[#2563EB]" />
                 Auditoria de Fluxo
              </h3>

              <div className="space-y-5 relative z-10 overflow-y-auto pr-2 custom-scrollbar flex-1 min-h-0">
                {recentMovements.map(renderMovementItem)}
                {movements.length === 0 && (
                    <p className="text-slate-400 text-sm text-center py-20">{loading ? "Carregando histórico…" : historyError ? "Histórico temporariamente indisponível." : "Sem histórico registrado."}</p>
                )}
              </div>

              <div className="mt-5 pt-5 border-t border-slate-800 shrink-0">
                 <button
                   type="button"
                   onClick={() => setIsHistoryModalOpen(true)}
                   disabled={movements.length === 0}
                   className="w-full py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                 >
                     Ver histórico completo →
                 </button>
              </div>
           </div>
        </div>
      </div>

      {isHistoryModalOpen && (
        <AccessibleOverlay label="Historico completo de estoque" onClose={() => setIsHistoryModalOpen(false)} className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-end justify-center p-0 md:items-center md:p-4 animate-in fade-in duration-300">
          <div className="bg-slate-950 border border-slate-800 rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col w-full max-w-2xl max-h-[88dvh] overflow-hidden animate-in slide-in-from-bottom-8 md:zoom-in-95 duration-200">
            <div className="p-5 sm:p-7 border-b border-slate-800 flex shrink-0 items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-300">Auditoria de Estoque</p>
                <h2 className="mt-1 text-xl font-black text-white uppercase tracking-tighter">Histórico completo</h2>
                <p className="mt-1 text-xs text-slate-500 font-bold">
                  {movements.length}{movementTotal !== null ? ` de ${movementTotal}` : ""} registros carregados, incluindo EPIs inativos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                aria-label="Fechar histórico completo"
                className="min-h-11 min-w-11 p-2 rounded-xl border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="min-h-0 p-5 sm:p-7 overflow-y-auto overscroll-contain custom-scrollbar">
              <div className="space-y-6">
                {movements.map(renderMovementItem)}
                {movements.length === 0 && (
                  <p className="text-slate-600 text-xs text-center py-20 italic">Sem histórico registrado.</p>
                )}
                {hasMoreMovements && <Button type="button" variant="outline" loading={loadingMoreMovements} loadingText="Carregando movimentos…" onClick={() => void loadMoreMovements()} disabled={loading} className="w-full border-slate-600 bg-transparent text-white hover:bg-slate-800 hover:text-white">Carregar mais 100 movimentos</Button>}
              </div>
            </div>
          </div>
        </AccessibleOverlay>
      )}

      {/* Modal Adicionar Movimento */}
      {isModalOpen && (
        <AccessibleOverlay label="Ajuste de saldo" onClose={() => { if (!savingRef.current) setIsModalOpen(false) }} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto border border-slate-200">
            <div className="p-5 sm:p-8 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="font-black text-slate-800 uppercase tracking-tighter text-2xl">Ajuste de Saldo</h2>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1 italic">Entrada de Compras ou Acerto Inventário</p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)} 
                disabled={isSaving}
                title="Fechar modal"
                aria-label="Fechar modal de ajuste de saldo"
                className="min-h-11 min-w-11 text-slate-500 hover:text-slate-700 p-2"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            
            <form onSubmit={handleAddMovement} className="p-5 sm:p-8 space-y-6">
              <div className="space-y-2">
                <label htmlFor="ppe_select" className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Equipamento (EPI)</label>
                <select 
                  id="ppe_select"
                  disabled={isSaving}
                  title="Selecionar equipamento para movimentação"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:border-[#2563EB] focus:bg-white transition-all font-bold appearance-none"
                  value={formData.ppe_id}
                  onChange={(e) => setFormData({...formData, ppe_id: e.target.value})}
                >
                  {ppes.map(p => (
                    <option key={p.id} value={p.id}>{p.name} (CA: {p.ca_number})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <label htmlFor="type_select" className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Tipo</label>
                    <select 
                        id="type_select"
                        disabled={isSaving}
                        title="Selecionar tipo de movimentação"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:border-[#2563EB] focus:bg-white transition-all font-bold"
                        value={formData.type}
                        onChange={(e) => setFormData({...formData, type: e.target.value as "ENTRADA" | "SAIDA" | "AJUSTE"})}
                    >
                        <option value="ENTRADA">Entrada (+)</option>
                        <option value="SAIDA">Saída (-)</option>
                        <option value="AJUSTE">Ajuste (Fixo)</option>
                    </select>
                 </div>
                 <div className="space-y-2">
                    <label htmlFor="quantity_input" className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Quantidade / Saldo</label>
                    <input 
                        id="quantity_input"
                        disabled={isSaving}
                        title="Informar quantidade"
                        type="number" 
                        min={formData.type === "AJUSTE" ? 0 : 1}
                        step={1}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:border-[#2563EB] focus:bg-white transition-all font-bold text-center"
                        value={formData.quantity}
                        onChange={(e) => setFormData({...formData, quantity: Number(e.target.value)})}
                    />
                 </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="motive_input" className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Motivo / Justificativa</label>
                <input 
                  id="motive_input"
                  disabled={isSaving}
                  title="Informar motivo"
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:border-[#2563EB] focus:bg-white transition-all font-bold"
                  placeholder="Ex: Nota Fiscal 1234 / Reposição Mensal"
                  value={formData.motive}
                  onChange={(e) => setFormData({...formData, motive: e.target.value})}
                />
              </div>

              <div className="pt-4 flex flex-col-reverse gap-3 sm:flex-row">
                <Button
                  type="button" 
                  variant="ghost"
                  disabled={isSaving}
                  onClick={() => setIsModalOpen(false)}
                  className="sm:flex-1 text-slate-600"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit" 
                  loading={isSaving}
                  loadingText="Registrando…"
                  className="sm:flex-[2]"
                >
                  Confirmar movimentação
                </Button>
              </div>
            </form>
          </div>
        </AccessibleOverlay>
      )}
      {pdfActionDialog}
    </div>
  )
}
