// responsive: revisado — mobile-first ✓
"use client"

import { useState, useEffect } from "react"
import { Package, Plus, History, Search, ArrowUpCircle, ArrowDownCircle, Settings2, Loader2, X, FileDown, FileSpreadsheet } from "lucide-react"
import { api } from "@/services/api"
import { PPE, StockMovement } from "@/types/database"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { MobileTableCard } from "@/components/ui/MobileTableCard"
import { Skeleton } from "@/components/ui/Skeleton"
import { useAuth } from "@/contexts/AuthContext"
import { toast } from "@/lib/toast"
import { usePdfActionDialog } from "@/hooks/usePdfActionDialog"
import { generateInventoryStockReportPDF } from "@/utils/pdfGenerator"
import { exportInventoryStockToExcel } from "@/utils/excelExporter"

export default function InventoryPage() {
  const { user } = useAuth()
  const { openPdfDialog, pdfActionDialog } = usePdfActionDialog()
  const [ppes, setPpes] = useState<PPE[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Form State
  const [formData, setFormData] = useState({
    ppe_id: "",
    quantity: 1,
    type: "ENTRADA" as "ENTRADA" | "SAIDA" | "AJUSTE",
    motive: "Compra / Reposição de Estoque"
  })

  const loadData = async () => {
    try {
      // Removed synchronous setLoading(true)
      const [ppeData, moveData] = await Promise.all([
        api.getPpes(),
        api.getStockMovements()
      ])
      setPpes(ppeData)
      setMovements(moveData)
      if (ppeData.length > 0) setFormData(prev => ({ ...prev, ppe_id: ppeData[0].id }))
    } catch (error) {
      console.error("Erro ao carregar estoque:", error)
    } finally {
      setLoading(false)
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
    if (!formData.ppe_id || formData.quantity <= 0) {
      toast.error("Informe um EPI e uma quantidade válida para ajustar o estoque.")
      return
    }

    try {
      setIsSaving(true)
      setLoading(true)
      await api.addStockMovement({
        ...formData,
        created_by_id: user?.id ?? null,
        created_by_name: user?.user_metadata?.full_name || user?.email || 'Sistema'
      })
      await loadData()
      setIsModalOpen(false)
      setFormData(prev => ({ ...prev, quantity: 1, motive: "Compra / Reposição de Estoque" }))
      toast.success("Ajuste de estoque registrado com sucesso.")
    } catch (error) {
      console.error('[Estoque] ERRO ao salvar movimentação:', error)
      toast.error(error instanceof Error ? error.message : "Erro ao aplicar ajuste de estoque.")
    } finally {
      setIsSaving(false)
      setLoading(false)
    }
  }

  const filteredPpes = ppes.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
  const stockReportPpes = filteredPpes.filter(ppe => Number(ppe.current_stock || 0) > 0)
  const recentMovements = movements.slice(0, 5)

  const getStockBadge = (stock: number) => {
    if (stock <= 0) return { label: "Zerado", variant: "border-red-200 bg-red-50 text-red-700" }
    if (stock <= 10) return { label: `${stock} baixo`, variant: "border-amber-200 bg-amber-50 text-amber-700" }
    return { label: `${stock} ok`, variant: "border-green-200 bg-green-50 text-green-700" }
  }

  const getRecentMovementsForPpe = (ppeId: string) =>
    movements
      .filter((movement) => movement.ppe_id === ppeId)
      .slice(0, 3)
      .map((movement) => `${movement.type} ${movement.quantity}`)
      .join(", ") || "Sem movimentações recentes"

  const getStockReportData = () => stockReportPpes.length > 0 ? stockReportPpes : filteredPpes

  const getStockFilterLabel = () => {
    const count = getStockReportData().length
    if (searchTerm.trim()) return `Busca: ${searchTerm.trim()} - ${count} item(ns)`
    return `Itens com saldo em estoque - ${count} item(ns)`
  }

  const handleExportInventoryPDF = () => {
    const reportData = getStockReportData()
    if (reportData.length === 0) {
      toast.error("Nenhum item de estoque para gerar relatório.")
      return
    }

    const blob = generateInventoryStockReportPDF({
      ppes: reportData,
      filterLabel: getStockFilterLabel(),
    })

    openPdfDialog(blob, `Relatorio_Estoque_${new Date().toISOString().slice(0, 10)}.pdf`, {
      title: "Relatório de estoque pronto",
      description: "Escolha se deseja abrir o PDF em uma nova aba ou baixar o arquivo.",
    })
  }

  const handleExportInventoryExcel = () => {
    const reportData = getStockReportData()
    if (reportData.length === 0) {
      toast.error("Nenhum item de estoque para exportar.")
      return
    }

    exportInventoryStockToExcel(reportData, getStockFilterLabel())
  }

  const renderMovementItem = (movement: StockMovement) => (
    <div key={movement.id} className="flex gap-4 items-start group">
      <div className={`p-2 rounded-xl shrink-0 ${movement.type === 'ENTRADA' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-blue-300'}`}>
        {movement.type === 'ENTRADA' ? <ArrowUpCircle className="w-4 h-4" /> : <ArrowDownCircle className="w-4 h-4" />}
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex justify-between items-start gap-3">
          <p className="text-[11px] font-black text-white uppercase tracking-tighter truncate max-w-[150px]">{movement.ppe?.name}</p>
          <span className={`text-xs font-black italic ${movement.type === 'ENTRADA' ? 'text-green-400' : 'text-blue-300'}`}>
            {movement.type === 'ENTRADA' ? '+' : '-'}{Math.abs(movement.quantity)}
          </span>
        </div>
        <p className="text-[10px] text-slate-500 italic leading-tight">{movement.motive}</p>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">
            {format(new Date(movement.created_at || ""), "dd/MM/yyyy • HH:mm", { locale: ptBR })}
          </p>
          {movement.created_by_name && (
            <span className="text-[8px] text-slate-500 italic">· {movement.created_by_name}</span>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
             <span className="bg-[#2563EB] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-widest uppercase italic">Almoxarifado SafeEPI</span>
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
            <Package className="w-8 h-8 mr-3 text-[#2563EB]" />
            Controle de Estoque
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium italic">Gestão de saldo físico e auditoria de entradas e saídas de EPIs.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={handleExportInventoryExcel}
            disabled={loading || filteredPpes.length === 0}
            className="w-full sm:w-auto border border-slate-200 bg-white px-5 py-4 text-xs font-black uppercase tracking-widest text-slate-600 shadow-sm transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 rounded-xl flex items-center justify-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            Excel
          </button>
          <button
            type="button"
            onClick={handleExportInventoryPDF}
            disabled={loading || filteredPpes.length === 0}
            className="w-full sm:w-auto border border-red-200 bg-red-50 px-5 py-4 text-xs font-black uppercase tracking-widest text-[#2563EB] shadow-sm transition-all hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 rounded-xl flex items-center justify-center gap-2"
          >
            <FileDown className="w-4 h-4" />
            PDF
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            title="Abrir formulário de entrada de estoque"
            className="w-full sm:w-auto bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-8 py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center shadow-lg shadow-blue-900/15"
          >
            <Plus className="w-4 h-4 mr-2" />
            Registrar Entrada
          </button>
        </div>
      </div>

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
                                { label: "Validade CA", value: ppe.ca_expiry_date ? format(new Date(`${ppe.ca_expiry_date}T12:00:00`), "dd/MM/yyyy", { locale: ptBR }) : "-" },
                                { label: "Categoria", value: "EPI" },
                                { label: "Movimentações", value: getRecentMovementsForPpe(ppe.id) },
                            ]}
                        />
                    ))}
                    {filteredPpes.length === 0 && (
                        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-400 italic font-medium">
                            Nenhum EPI encontrado.
                        </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsHistoryModalOpen(true)}
                      disabled={movements.length === 0}
                      className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                    >
                      Ver auditoria de fluxo
                    </button>
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
                                        <span className={`text-lg sm:text-xl font-black tracking-tighter ${ppe.current_stock > 10 ? 'text-slate-800' : 'text-[#2563EB]'}`}>
                                            {ppe.current_stock}
                                        </span>
                                    </td>
                                    <td className="px-4 md:px-6 py-5 text-center">
                                        {ppe.current_stock <= 10 ? (
                                            <span className="px-1.5 sm:px-2 py-1 bg-blue-50 text-[#2563EB] text-[7px] sm:text-[8px] font-black rounded uppercase tracking-widest border border-blue-100 block sm:inline-block">Estoque<br className="sm:hidden"/> Baixo</span>
                                        ) : (
                                            <span className="px-1.5 sm:px-2 py-1 bg-green-50 text-green-700 text-[7px] sm:text-[8px] font-black rounded uppercase tracking-widest border border-green-100 block sm:inline-block">Ok</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                </>
             )}
          </div>
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
                    <p className="text-slate-600 text-xs text-center py-20 italic">Sem histórico registrado.</p>
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
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-end justify-center p-0 md:items-center md:p-4 animate-in fade-in duration-300">
          <div className="bg-slate-950 border border-slate-800 rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88dvh] overflow-hidden animate-in slide-in-from-bottom-8 md:zoom-in-95 duration-200">
            <div className="p-5 sm:p-7 border-b border-slate-800 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-300">Auditoria de Estoque</p>
                <h2 className="mt-1 text-xl font-black text-white uppercase tracking-tighter">Histórico completo</h2>
                <p className="mt-1 text-xs text-slate-500 font-bold">
                  {movements.length} movimentação(ões) de EPIs ativos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                aria-label="Fechar histórico completo"
                className="p-2 rounded-xl border border-slate-800 text-slate-500 hover:text-white hover:border-slate-600 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-7 max-h-[68dvh] overflow-y-auto custom-scrollbar">
              <div className="space-y-6">
                {movements.map(renderMovementItem)}
                {movements.length === 0 && (
                  <p className="text-slate-600 text-xs text-center py-20 italic">Sem histórico registrado.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Adicionar Movimento */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="p-5 sm:p-8 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="font-black text-slate-800 uppercase tracking-tighter text-2xl">Ajuste de Saldo</h2>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1 italic">Entrada de Compras ou Acerto Inventário</p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)} 
                title="Fechar modal"
                aria-label="Fechar modal de ajuste de saldo"
                className="text-slate-300 hover:text-slate-600 p-2"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            
            <form onSubmit={handleAddMovement} className="p-5 sm:p-8 space-y-6">
              <div className="space-y-2">
                <label htmlFor="ppe_select" className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Equipamento (EPI)</label>
                <select 
                  id="ppe_select"
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

              <div className="grid grid-cols-2 gap-6">
                 <div className="space-y-2">
                    <label htmlFor="type_select" className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Tipo</label>
                    <select 
                        id="type_select"
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
                        title="Informar quantidade"
                        type="number" 
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:border-[#2563EB] focus:bg-white transition-all font-bold text-center"
                        value={formData.quantity}
                        onChange={(e) => setFormData({...formData, quantity: parseInt(e.target.value) || 0})}
                    />
                 </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="motive_input" className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Motivo / Justificativa</label>
                <input 
                  id="motive_input"
                  title="Informar motivo"
                  type="text" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:border-[#2563EB] focus:bg-white transition-all font-bold"
                  placeholder="Ex: Nota Fiscal 1234 / Reposição Mensal"
                  value={formData.motive}
                  onChange={(e) => setFormData({...formData, motive: e.target.value})}
                />
              </div>

              <div className="pt-6 flex gap-4">
                <button 
                  type="button" 
                  disabled={isSaving}
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-4 text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-[0.2em] transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isSaving}
                  className="flex-[2] px-4 py-4 text-xs font-black text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-2xl uppercase tracking-widest transition-all shadow-xl shadow-blue-900/20 shadow-lg shadow-blue-900/15 flex items-center justify-center"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirmar Movimentação"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {pdfActionDialog}
    </div>
  )
}
