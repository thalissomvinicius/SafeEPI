"use client"

import { useState, useEffect } from "react"
import { ArrowRightLeft, Search, Calendar, Filter, FileSpreadsheet, Loader2, ArrowUpRight, ArrowDownLeft, Shield, Users, FileDown, Presentation, X } from "lucide-react"
import { api } from "@/services/api"
import { useAuth } from "@/contexts/AuthContext"
import { useRouter } from "next/navigation"
import { format, startOfMonth, endOfMonth, subDays, isWithinInterval } from "date-fns"
import { ptBR } from "date-fns/locale"
import { DeliveryWithRelations } from "@/types/database"
import { exportDeliveriesToExcel } from "@/utils/excelExporter"
import { generateMovementsSimplePDF, generateMovementsPresentationPDF } from "@/utils/pdfGenerator"
import { usePdfActionDialog } from "@/hooks/usePdfActionDialog"

type DateFilter = 'all' | 'month' | 'last30' | 'last60' | 'last90' | 'custom' | 'specific_month'

export default function MovementsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const { openPdfDialog, pdfActionDialog } = usePdfActionDialog()
  const [loading, setLoading] = useState(true)
  const [rawDeliveries, setRawDeliveries] = useState<DeliveryWithRelations[]>([])
  const [showPdfModal, setShowPdfModal] = useState(false)

  // Filter State
  const [dateFilter, setDateFilter] = useState<DateFilter>('month')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [specificMonth, setSpecificMonth] = useState<string>('')
  const [specificMonthSel, setSpecificMonthSel] = useState<string>(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [specificYearSel, setSpecificYearSel] = useState<string>(String(new Date().getFullYear()))
  const [searchTerm, setSearchTerm] = useState("")

  // Auth protection
  useEffect(() => {
    if (!authLoading && user && user.role === 'ALMOXARIFE') {
      router.push('/')
    }
  }, [user, authLoading, router])

  // Load Data
  useEffect(() => {
    async function loadData() {
      if (!user || user.role === 'ALMOXARIFE') return
      try {
        setLoading(true)
        const data = await api.getDeliveries()
        setRawDeliveries(data)
      } catch (err) {
        console.error("Erro ao carregar movimentações:", err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [user])

  // Filter Logic
  const getFilteredData = () => {
    let filtered = rawDeliveries
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
        start = new Date(customStartDate)
        end = new Date(customEndDate + 'T23:59:59')
      } else if (dateFilter === 'specific_month' && specificMonth) {
        start = new Date(specificMonth + '-01T00:00:00')
        end = endOfMonth(start)
      }

      if (start) {
        filtered = filtered.filter(d => {
          const dDate = new Date(d.delivery_date)
          return isWithinInterval(dDate, { start: start!, end })
        })
      }
    }

    if (searchTerm) {
      const lower = searchTerm.toLowerCase()
      filtered = filtered.filter(d =>
        d.employee?.full_name.toLowerCase().includes(lower) ||
        d.ppe?.name.toLowerCase().includes(lower) ||
        d.employee?.cpf.includes(searchTerm)
      )
    }

    return filtered.sort((a, b) => new Date(b.delivery_date).getTime() - new Date(a.delivery_date).getTime())
  }

  const filteredMovements = getFilteredData()

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

  const handleSimplePDF = () => {
    const blob = generateMovementsSimplePDF({ movements: filteredMovements, stats, period: getPeriodLabel() })
    openPdfDialog(blob, `Movimentacoes_Simples_${new Date().toISOString().slice(0,10)}.pdf`, {
      title: "PDF Simples — Movimentações",
      description: `Período: ${getPeriodLabel()} · ${filteredMovements.length} registros`
    })
    setShowPdfModal(false)
  }

  const handlePresentationPDF = () => {
    const blob = generateMovementsPresentationPDF({ movements: filteredMovements, stats, period: getPeriodLabel() })
    openPdfDialog(blob, `Movimentacoes_Apresentacao_${new Date().toISOString().slice(0,10)}.pdf`, {
      title: "PDF Apresentação — Movimentações",
      description: `Período: ${getPeriodLabel()} · ${filteredMovements.length} registros`
    })
    setShowPdfModal(false)
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
            <ArrowRightLeft className="w-6 h-6 mr-2 text-[#8B1A1A]" />
            Movimentações Mensais
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium italic">Monitoramento completo de entradas e saídas por período.</p>
        </div>

        <div className="w-full md:w-auto flex gap-2">
          <button
            onClick={() => exportDeliveriesToExcel(filteredMovements)}
            title="Exportar para planilha Excel"
            className="flex-1 md:flex-none bg-[#1e293b] hover:bg-slate-800 text-white px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel
          </button>
          <button
            onClick={() => setShowPdfModal(true)}
            title="Gerar relatório em PDF"
            className="flex-1 md:flex-none bg-[#8B1A1A] hover:bg-[#681313] text-white px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-red-900/20 flex items-center justify-center gap-2"
          >
            <FileDown className="w-4 h-4" />
            PDF
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row gap-6 items-end">
          <div className="flex-1 space-y-2 w-full">
            <label id="label-periodo" className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
              <Calendar className="w-3 h-3 mr-1" /> Período
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
                  className={`px-3 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border ${
                    dateFilter === opt.id
                      ? "bg-[#8B1A1A] border-[#8B1A1A] text-white shadow-md shadow-red-900/20"
                      : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-white hover:border-slate-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-2 w-full">
            <label id="label-outros" className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
              <Filter className="w-3 h-3 mr-1" /> Outros Filtros
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                title="Filtrar por mês específico"
                onClick={() => setDateFilter('specific_month')}
                className={`px-3 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border ${
                  dateFilter === 'specific_month'
                    ? "bg-[#8B1A1A] border-[#8B1A1A] text-white shadow-md shadow-red-900/20"
                    : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-white hover:border-slate-300"
                }`}
              >
                Mês Específico
              </button>
              <button
                title="Filtrar por período personalizado"
                onClick={() => setDateFilter('custom')}
                className={`px-3 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all border ${
                  dateFilter === 'custom'
                    ? "bg-[#8B1A1A] border-[#8B1A1A] text-white shadow-md shadow-red-900/20"
                    : "bg-slate-50 border-slate-100 text-slate-500 hover:bg-white hover:border-slate-300"
                }`}
              >
                Personalizado
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-2 w-full">
            <label htmlFor="search-mov" className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
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
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:border-[#8B1A1A] outline-none transition-all"
            />
          </div>
        </div>

        {/* Custom Inputs */}
        {dateFilter === 'specific_month' && (
          <div className="pt-4 border-t border-slate-50 animate-in slide-in-from-top-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Selecione o Mês</label>
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
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:border-[#8B1A1A] outline-none"
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
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:border-[#8B1A1A] outline-none"
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
              <label htmlFor="custom-start" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Início</label>
              <input
                id="custom-start"
                type="date"
                title="Data de início"
                aria-label="Data de início"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:border-[#8B1A1A] outline-none"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="custom-end" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Fim</label>
              <input
                id="custom-end"
                type="date"
                title="Data de fim"
                aria-label="Data de fim"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:border-[#8B1A1A] outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Stats Quick View */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Entregas", value: stats.deliveries, icon: ArrowUpRight, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Devoluções", value: stats.returns, icon: ArrowDownLeft, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Itens Movimentados", value: stats.totalItems, icon: Shield, color: "text-[#8B1A1A]", bg: "bg-red-50" },
          { label: "Pessoas Atendidas", value: stats.uniqueEmployees, icon: Users, color: "text-slate-600", bg: "bg-slate-50" },
        ].map((s, i) => (
          <div key={i} className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${s.bg}`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{s.label}</p>
              <p className="text-xl font-black text-slate-800 tracking-tighter mt-0.5">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main Table */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto min-h-[400px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <Loader2 className="w-10 h-10 animate-spin mb-4 text-[#8B1A1A]" />
              <p className="text-sm font-black uppercase tracking-widest italic">Acessando Banco de Dados...</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-[10px] text-slate-400 bg-slate-50/50 uppercase tracking-[0.2em] border-b border-slate-100 font-black">
                <tr>
                  <th className="px-6 py-5">Data / Hora</th>
                  <th className="px-6 py-5">Colaborador</th>
                  <th className="px-6 py-5">EPI / CA</th>
                  <th className="px-6 py-5 text-center">Qtd</th>
                  <th className="px-6 py-5 text-center">Tipo</th>
                  <th className="px-6 py-5">Unidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredMovements.map((move, i) => (
                  <tr key={i} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-700">{format(new Date(move.delivery_date), "dd/MM/yyyy")}</span>
                        <span className="text-[10px] text-slate-400 font-medium">{format(new Date(move.delivery_date), "HH:mm")}h</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="font-black text-slate-800 uppercase tracking-tighter">{move.employee?.full_name}</span>
                        <span className="text-[10px] text-slate-400 font-bold tracking-widest">{move.employee?.cpf}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-600">{move.ppe?.name}</span>
                        <span className="text-[10px] text-slate-400 font-medium uppercase">C.A. {move.ppe?.ca_number}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-black text-xs">
                        {move.quantity}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-center">
                      {move.returned_at ? (
                        <span className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[9px] font-black uppercase tracking-widest inline-flex items-center gap-1">
                          <ArrowDownLeft className="w-3 h-3" /> Devolução
                        </span>
                      ) : (
                        <span className="px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-[9px] font-black uppercase tracking-widest inline-flex items-center gap-1">
                          <ArrowUpRight className="w-3 h-3" /> Entrega
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest truncate max-w-[120px] block">
                        {move.workplace?.name || "Geral"}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredMovements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-20 text-center text-slate-400 italic">
                      <ArrowRightLeft className="w-10 h-10 mx-auto mb-4 opacity-20" />
                      <p className="text-sm font-black uppercase tracking-widest">Nenhuma movimentação neste período.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* PDF Choice Modal */}
      {showPdfModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200 animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl">Gerar Relatório PDF</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Escolha o formato ideal para sua necessidade</p>
              </div>
              <button onClick={() => setShowPdfModal(false)} title="Fechar" className="text-slate-400 hover:text-slate-600 transition-colors p-2 hover:bg-slate-50 rounded-xl">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Simple PDF */}
              <button
                onClick={handleSimplePDF}
                className="group flex flex-col items-center text-center p-6 rounded-2xl border-2 border-slate-100 hover:border-[#8B1A1A]/30 hover:bg-red-50/30 transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-100 group-hover:bg-[#8B1A1A]/10 flex items-center justify-center mb-4 transition-all">
                  <FileDown className="w-7 h-7 text-slate-500 group-hover:text-[#8B1A1A]" />
                </div>
                <h3 className="font-black text-slate-800 uppercase tracking-tighter text-sm mb-2">PDF Simples</h3>
                <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                  Relatório operacional com tabela completa e resumo de indicadores. Ideal para arquivo e controle interno.
                </p>
                <span className="mt-4 text-[9px] font-black uppercase tracking-widest text-slate-400 bg-slate-100 px-3 py-1.5 rounded-lg">
                  Retrato · 1 página+
                </span>
              </button>

              {/* Presentation PDF */}
              <button
                onClick={handlePresentationPDF}
                className="group flex flex-col items-center text-center p-6 rounded-2xl border-2 border-slate-100 hover:border-[#8B1A1A]/30 hover:bg-red-50/30 transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-[#8B1A1A]/10 group-hover:bg-[#8B1A1A]/20 flex items-center justify-center mb-4 transition-all">
                  <Presentation className="w-7 h-7 text-[#8B1A1A]" />
                </div>
                <h3 className="font-black text-slate-800 uppercase tracking-tighter text-sm mb-2">PDF Apresentação</h3>
                <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                  Relatório executivo com gráficos visuais e layout premium. Ideal para reuniões com gestores e diretoria.
                </p>
                <span className="mt-4 text-[9px] font-black uppercase tracking-widest text-[#8B1A1A] bg-red-50 border border-red-100 px-3 py-1.5 rounded-lg">
                  Paisagem · 2 páginas
                </span>
              </button>
            </div>

            <div className="px-6 pb-6">
              <p className="text-[10px] text-center text-slate-400 italic">
                Período: <strong>{getPeriodLabel()}</strong> · {filteredMovements.length} movimentações
              </p>
            </div>
          </div>
        </div>
      )}
      {pdfActionDialog}
    </div>
  )
}
