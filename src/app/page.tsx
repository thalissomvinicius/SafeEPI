// responsive: revisado — mobile-first ✓
"use client"

import { useState, useEffect } from "react"
import { Users, AlertTriangle, PackageCheck, ArrowRight, ShieldCheck, Archive, Boxes, Calendar } from "lucide-react"
import Link from "next/link"
import { api, type DashboardSummary } from "@/services/api"
import { Skeleton } from "@/components/ui/Skeleton"
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts"
import { formatDeliveryDate } from "@/lib/dateOnly"
import { useActiveBrand } from "@/hooks/useActiveBrand"
import { useAuth } from "@/contexts/AuthContext"

type DashboardDateFilter = "last7" | "month" | "last30" | "custom" | "all"
type DashboardEmployeeScope = "own" | "third_party" | "all"

function DashboardSkeleton() {
  return (
    <div className="p-6 md:p-8 md:pt-10 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-100 pb-8 gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-12 w-40" />
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-10" />
            </div>
            <Skeleton className="h-8 w-16 mb-2" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 h-[400px]">
          <Skeleton className="h-full w-full rounded-2xl" />
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 space-y-4">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-full w-full rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const activeBrand = useActiveBrand(user?.role === "MASTER" ? null : user?.company)
  const brandColor = activeBrand.primaryColor
  const [stats, setStats] = useState({
    deliveries: 0,
    employees: 0,
    criticalCAs: 0,
    lowStock: 0,
    signedDocuments: 0,
  })
  const [employeeCounts, setEmployeeCounts] = useState({ own: 0, third_party: 0, all: 0 })
  const [recentDeliveries, setRecentDeliveries] = useState<DashboardSummary["recentDeliveries"]>([])
  const [chartData, setChartData] = useState<{name: string, value: number}[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoadedData, setHasLoadedData] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [dateFilter, setDateFilter] = useState<DashboardDateFilter>("last7")
  const [employeeScope, setEmployeeScope] = useState<DashboardEmployeeScope>("own")
  const [customStartDate, setCustomStartDate] = useState("")
  const [customEndDate, setCustomEndDate] = useState("")

  useEffect(() => {
    if (dateFilter === "custom" && (!customStartDate || !customEndDate)) {
      return
    }

    const controller = new AbortController()
    const now = new Date()
    const getStartDate = (): Date | null => {
      if (dateFilter === "last7") {
        const start = new Date(now)
        start.setDate(start.getDate() - 6)
        start.setHours(0, 0, 0, 0)
        return start
      }
      if (dateFilter === "month") {
        return new Date(now.getFullYear(), now.getMonth(), 1)
      }
      if (dateFilter === "last30") {
        const start = new Date(now)
        start.setDate(start.getDate() - 29)
        start.setHours(0, 0, 0, 0)
        return start
      }
      if (dateFilter === "custom" && customStartDate) {
        return new Date(`${customStartDate}T00:00:00`)
      }
      return null
    }
    const getEndDate = (): Date => {
      if (dateFilter === "custom" && customEndDate) return new Date(`${customEndDate}T23:59:59`)
      return now
    }
    const startDate = getStartDate()
    const endDate = getEndDate()
    const chartStart = startDate || (() => {
      const start = new Date(now)
      start.setDate(start.getDate() - 29)
      start.setHours(0, 0, 0, 0)
      return start
    })()
    chartStart.setHours(0, 0, 0, 0)

    async function loadDashboardData() {
      setLoading(true)
      setLoadError(null)
      try {
        const summary = await api.getDashboardSummary({
          allHistory: dateFilter === "all",
          start: (startDate || new Date(0)).toISOString(),
          end: endDate.toISOString(),
          chartStart: chartStart.toISOString(),
          chartEnd: endDate.toISOString(),
          scope: employeeScope,
        }, controller.signal)
        setStats(summary.stats)
        setEmployeeCounts(summary.employeeCounts)
        setRecentDeliveries(summary.recentDeliveries)
        setChartData(summary.chartData.map((bucket) => ({
          name: new Date(`${bucket.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          value: bucket.value,
        })))
        setHasLoadedData(true)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Erro dashboard:", error)
          setLoadError(error instanceof Error ? error.message : "Nao foi possivel carregar os indicadores.")
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadDashboardData()

    return () => {
      controller.abort()
    }
  }, [dateFilter, customStartDate, customEndDate, employeeScope, reloadVersion])

  if (loading && !hasLoadedData) return <DashboardSkeleton />

  if (loadError && !hasLoadedData) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center p-6">
        <div role="alert" className="w-full rounded-3xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-amber-500" aria-hidden="true" />
          <h1 className="text-xl font-black text-slate-900">Os dados continuam seguros</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium text-slate-600">
            O painel nao conseguiu consultar o Supabase agora. Os valores nao foram substituidos por zero.
          </p>
          <p className="mt-2 text-xs text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => setReloadVersion((version) => version + 1)}
            className="mt-6 min-h-11 rounded-xl bg-[#2563EB] px-5 py-3 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  const employeeCardTitle = employeeScope === "third_party" ? "Terceiros Ativos" : employeeScope === "all" ? "Equipe Total" : "Equipe Ativa"
  const employeeCardSubtitle = employeeScope === "third_party" ? "Colaboradores terceiros" : employeeScope === "all" ? "Proprios + terceiros" : "Colaboradores proprios"
  const employeeScopeOptions = [
    { value: "own" as const, label: "Próprios", count: employeeCounts.own },
    { value: "third_party" as const, label: "Terceiros", count: employeeCounts.third_party },
    { value: "all" as const, label: "Todos", count: employeeCounts.all },
  ]

  return (
    <div className="p-4 sm:p-6 md:p-8 md:pt-10 max-w-7xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500">
      {loadError && (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-bold">Falha temporaria ao atualizar. Mantivemos os ultimos dados carregados.</span>
          <button type="button" onClick={() => setReloadVersion((version) => version + 1)} className="min-h-11 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest">
            Atualizar
          </button>
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-end border-b border-slate-100 pb-6 md:pb-8 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-[#2563EB] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-wide md:tracking-widest uppercase italic">SESMT Digital • Cloud</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tighter text-slate-800 leading-tight">Painel de Risco Operacional</h1>
          <p className="text-sm sm:text-base text-slate-500 font-medium mt-1">Cada entrega registrada. Cada risco sob controle.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={dateFilter}
                onChange={(event) => {
                  const nextFilter = event.target.value as DashboardDateFilter
                  setDateFilter(nextFilter)
                  if (nextFilter === "custom") setLoading(false)
                }}
                title="Filtrar dashboard por período"
                className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-9 text-xs font-black uppercase tracking-widest text-slate-600 outline-none transition-colors focus:border-[#2563EB] sm:w-auto"
              >
                <option value="last7">Últimos 7 dias</option>
                <option value="month">Este mês</option>
                <option value="last30">Últimos 30 dias</option>
                <option value="custom">Período</option>
                <option value="all">Todo histórico</option>
              </select>
            </div>
            {dateFilter === "custom" && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(event) => setCustomStartDate(event.target.value)}
                  title="Data inicial"
                  className="h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none focus:border-[#2563EB]"
                />
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(event) => setCustomEndDate(event.target.value)}
                  title="Data final"
                  className="h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none focus:border-[#2563EB]"
                />
              </div>
            )}
          </div>
          <Link href="/delivery" className="w-full md:w-auto bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center">
            Nova Entrega <ArrowRight className="w-4 h-4 ml-2" />
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Equipe nos indicadores</p>
          <p className="mt-0.5 text-sm font-bold text-slate-700">Escolha se o dashboard conta próprios, terceiros ou todos.</p>
        </div>
        <div className="grid w-full grid-cols-3 rounded-xl bg-slate-100 p-1 sm:w-auto sm:min-w-[360px]">
          {employeeScopeOptions.map((scope) => (
            <button
              key={scope.value}
              type="button"
              onClick={() => setEmployeeScope(scope.value)}
              className={`min-h-11 rounded-lg px-3 py-2 text-center transition-all ${
                employeeScope === scope.value
                  ? "bg-white text-[#2563EB] shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500 hover:bg-white/70 hover:text-slate-800"
              }`}
              title={`Exibir ${scope.label.toLowerCase()}`}
            >
              <span className="block text-[10px] font-black uppercase tracking-widest">{scope.label}</span>
              <span className="mt-0.5 block text-sm font-black">{scope.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {[
          { title: "Entregas Realizadas", value: stats.deliveries, subtitle: dateFilter === "all" ? "Todo o histórico" : "No período filtrado", icon: PackageCheck, color: "text-[#2563EB]", bg: "bg-red-50" },
          { title: employeeCardTitle, value: stats.employees, subtitle: employeeCardSubtitle, icon: Users, color: "text-slate-800", bg: "bg-slate-100" },
          { title: "Estoque Baixo", value: stats.lowStock, subtitle: "Itens com 5 ou menos", icon: Boxes, color: "text-blue-700", bg: "bg-blue-50" },
          { title: "PDFs Auditados", value: stats.signedDocuments, subtitle: dateFilter === "all" ? "Arquivo jurídico ativo" : "No período filtrado", icon: Archive, color: "text-emerald-700", bg: "bg-emerald-50" },
          { title: "CAs em Alerta", value: stats.criticalCAs, subtitle: "Atenção necessária", icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
        ].map((item, idx) => {
          const Icon = item.icon
          return (
            <div key={idx} className="min-w-0 bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <span className="min-w-0 break-words text-slate-400 font-black text-[10px] uppercase tracking-widest">{item.title}</span>
                <div className={`p-2 rounded-lg ${item.bg}`}>
                  <Icon className={`w-5 h-5 ${item.color}`} />
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-slate-800 tracking-tight">{item.value}</span>
                <span className="text-xs font-bold text-slate-500 mt-1">{item.subtitle}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 shadow-sm flex flex-col min-w-0">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg">Atividade de Entregas</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Período selecionado</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-[#2563EB] rounded-full animate-pulse"></div>
                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Live Sync</span>
                </div>
            </div>
            
            <div className="h-[200px] min-h-[200px] w-full min-w-0 md:h-[280px] md:min-h-[280px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                    <AreaChart data={chartData}>
                        <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={brandColor} stopOpacity={0.1}/>
                                <stop offset="95%" stopColor={brandColor} stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}}
                            dy={10}
                            interval="preserveStartEnd"
                        />
                        <YAxis hide />
                        <Tooltip 
                            formatter={(value) => [value ?? 0, "Entregas"]}
                            contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 'bold'}}
                            cursor={{stroke: brandColor, strokeWidth: 2, strokeDasharray: '4 4'}}
                        />
                        <Area 
                            type="monotone" 
                            dataKey="value" 
                            stroke={brandColor}
                            strokeWidth={4} 
                            fillOpacity={1} 
                            fill="url(#colorValue)" 
                            animationDuration={2000}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm flex flex-col h-full min-w-0 overflow-hidden">
            <div className="p-5 sm:p-8 border-b border-slate-50 flex justify-between items-center">
                <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg">Histórico Local</h3>
                <ShieldCheck className="w-5 h-5 text-green-500" />
            </div>
            <div className="flex-1 overflow-y-auto">
                <div className="divide-y divide-slate-50">
                    {recentDeliveries.map((delivery) => (
                        <div key={delivery.id} className="p-6 hover:bg-slate-50 transition-colors">
                            <div className="flex justify-between items-start mb-1">
                                <p className="font-black text-slate-800 uppercase tracking-tight text-sm truncate max-w-[150px]">
                                    {delivery.employee?.full_name}
                                </p>
                                <span className="text-[9px] font-black text-slate-400">#{delivery.id.slice(0,4)}</span>
                            </div>
                            <p className="text-[10px] text-slate-500 font-medium">
                                {delivery.ppe?.name} • {formatDeliveryDate(delivery.delivery_date)}
                            </p>
                            <div className="mt-3 flex items-center justify-between">
                                <span className="px-2 py-0.5 bg-green-50 text-green-700 text-[8px] font-black uppercase rounded tracking-widest border border-green-100">Assinado</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="p-6 bg-slate-50 mt-auto border-t border-slate-100">
                <Link href="/history" className="min-h-11 w-full text-[10px] font-black text-[#2563EB] uppercase tracking-widest hover:underline flex items-center justify-center">
                    Ver auditoria completa <ArrowRight className="w-3 h-3 ml-1" />
                </Link>
            </div>
        </div>
      </div>
    </div>
  )
}
