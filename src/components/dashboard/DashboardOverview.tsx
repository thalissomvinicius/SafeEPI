"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Archive, Boxes, Calendar, PackageCheck, RefreshCw, Users } from "lucide-react"
import Link from "next/link"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { api, type DashboardSummary } from "@/services/api"
import { Skeleton } from "@/components/ui/Skeleton"
import { getDashboardDateRange, type DashboardDateFilter } from "./dashboardFilters"
import { formatDeliveryDate } from "@/lib/dateOnly"
import { useActiveBrand } from "@/hooks/useActiveBrand"
import { useAuth } from "@/contexts/AuthContext"

type DashboardEmployeeScope = "own" | "third_party" | "all"

const focusStyle = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-color)] focus-visible:ring-offset-2"
const inputStyle = "min-h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-[var(--brand-color)] focus:ring-2 focus:ring-[var(--brand-color)]/10"
const numberFormat = new Intl.NumberFormat("pt-BR")

function DashboardDataSkeleton() {
  return (
    <div role="status" aria-label="Carregando indicadores" className="space-y-6">
      <span className="sr-only">Carregando indicadores da empresa.</span>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5">
            <Skeleton className="mb-5 h-4 w-24 max-w-full" />
            <Skeleton className="h-9 w-16" />
            <Skeleton className="mt-3 h-3 w-28 max-w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Skeleton className="h-80 w-full rounded-2xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    </div>
  )
}

export function DashboardOverview() {
  const { user } = useAuth()
  const activeBrand = useActiveBrand(user?.role === "MASTER" ? null : user?.company)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [dateFilter, setDateFilter] = useState<DashboardDateFilter>("last7")
  const [employeeScope, setEmployeeScope] = useState<DashboardEmployeeScope>("own")
  const [customStartDate, setCustomStartDate] = useState("")
  const [customEndDate, setCustomEndDate] = useState("")
  const dateRange = useMemo(
    () => getDashboardDateRange(dateFilter, customStartDate, customEndDate),
    // Refresh the period's end time on an explicit refresh as well as a filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateFilter, customStartDate, customEndDate, reloadVersion],
  )
  const periodError = typeof dateRange === "string" ? dateRange : null
  const refreshing = loading && !periodError

  useEffect(() => {
    if (typeof dateRange === "string") return
    const filters = { ...dateRange, scope: employeeScope }
    const controller = new AbortController()

    async function loadDashboardData() {
      setLoading(true)
      setLoadError(null)
      try {
        const result = await api.getDashboardSummary(filters, controller.signal)
        if (controller.signal.aborted) return
        setSummary(result)
        setUpdatedAt(new Date())
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("Erro ao consultar indicadores:", error)
        setLoadError("Não foi possível atualizar os indicadores. Tente novamente.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadDashboardData()
    return () => controller.abort()
  }, [dateRange, employeeScope])

  const employeeScopeOptions = [
    { value: "own" as const, label: "Próprios", count: summary?.employeeCounts.own },
    { value: "third_party" as const, label: "Terceiros", count: summary?.employeeCounts.third_party },
    { value: "all" as const, label: "Todos", count: summary?.employeeCounts.all },
  ]
  const chartData = summary?.chartData.map((bucket) => ({
    name: new Date(`${bucket.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    value: bucket.value,
  })) || []
  const chartHasActivity = chartData.some((bucket) => bucket.value > 0)
  const chartCaption = typeof dateRange !== "string" && dateRange.chartIsLimited
    ? "Últimos 30 dias do período. Os totais consideram o período completo."
    : "Quantidade de entregas por dia no período selecionado."

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">Gestão de equipamentos</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Visão geral</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Entregas, equipe e pontos de atenção em um só lugar.</p>
        </div>
        <Link href="/delivery" className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--brand-color)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--brand-color-strong)] motion-safe:active:scale-[0.98] ${focusStyle}`}>
          Nova entrega <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </header>

      <section aria-label="Filtros dos indicadores" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:w-48">
              <label htmlFor="dashboard-period" className="mb-2 block text-xs font-semibold text-slate-600">Período das entregas e PDFs</label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                <select id="dashboard-period" value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DashboardDateFilter)} className={`${inputStyle} pl-9 pr-8`}>
                  <option value="last7">Últimos 7 dias</option><option value="month">Este mês</option><option value="last30">Últimos 30 dias</option><option value="custom">Personalizado</option><option value="all">Todo o histórico</option>
                </select>
              </div>
            </div>
            {dateFilter === "custom" && (
              <div className="grid min-w-0 grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label htmlFor="dashboard-start" className="mb-2 block text-xs font-semibold text-slate-600">Data inicial</label>
                  <input id="dashboard-start" type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} max={customEndDate || undefined} aria-describedby={periodError ? "dashboard-period-error" : undefined} aria-invalid={Boolean(periodError && customStartDate && customEndDate)} className={inputStyle} />
                </div>
                <div className="min-w-0">
                  <label htmlFor="dashboard-end" className="mb-2 block text-xs font-semibold text-slate-600">Data final</label>
                  <input id="dashboard-end" type="date" value={customEndDate} onChange={(event) => setCustomEndDate(event.target.value)} min={customStartDate || undefined} aria-describedby={periodError ? "dashboard-period-error" : undefined} aria-invalid={Boolean(periodError && customStartDate && customEndDate)} className={inputStyle} />
                </div>
              </div>
            )}
          </div>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-xs font-semibold text-slate-600">Equipe ativa</legend>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 sm:min-w-72">
              {employeeScopeOptions.map((scope) => (
                <button key={scope.value} type="button" onClick={() => setEmployeeScope(scope.value)} aria-pressed={employeeScope === scope.value} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-xs font-semibold transition-colors ${focusStyle} ${employeeScope === scope.value ? "bg-white text-[var(--brand-color)] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                  {scope.label} <span className="tabular-nums">{scope.count === undefined ? "—" : numberFormat.format(scope.count)}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="mt-3 flex flex-col gap-2 text-xs leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>O vínculo altera a contagem da equipe. Entregas, PDFs, estoque e CAs abrangem a empresa.</p>
          <button type="button" onClick={() => setReloadVersion((version) => version + 1)} disabled={refreshing || Boolean(periodError)} className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-50 ${focusStyle}`}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />{refreshing ? "Atualizando" : "Atualizar"}
          </button>
        </div>
        {periodError && <p id="dashboard-period-error" role="status" className="mt-2 text-sm text-amber-700">{periodError} Os indicadores anteriores foram mantidos.</p>}
      </section>

      {loadError && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">{loadError}</p>
            <p className="mt-1 text-xs leading-5">
              {summary ? "Mantivemos a última consulta; os dados abaixo podem estar desatualizados." : "Não exibimos números zerados quando a consulta falha. Use Atualizar para tentar novamente."}
            </p>
          </div>
        </div>
      )}
      {!summary && refreshing && <DashboardDataSkeleton />}
      {!summary && !refreshing && (
        <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-12 text-center">
          <PackageCheck className="mx-auto mb-4 h-8 w-8 text-slate-400" aria-hidden="true" />
          <h2 className="font-semibold text-slate-800">Indicadores indisponíveis</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Você pode continuar para uma nova entrega ou atualizar a consulta acima.</p>
        </div>
      )}

      {summary && <div aria-busy={refreshing} className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
          {[
            { title: "Entregas", value: summary.stats.deliveries, subtitle: dateFilter === "all" ? "Todo o histórico" : "No período", icon: PackageCheck, tone: "text-[var(--brand-color)]" },
            { title: "Equipe ativa", value: summary.stats.employees, subtitle: employeeScope === "all" ? "Próprios e terceiros" : employeeScope === "third_party" ? "Colaboradores terceiros" : "Colaboradores próprios", icon: Users, tone: "text-slate-500" },
            { title: "Estoque baixo", value: summary.stats.lowStock, subtitle: "Itens com 5 ou menos", icon: Boxes, tone: summary.stats.lowStock > 0 ? "text-amber-600" : "text-slate-500" },
            { title: "PDFs arquivados", value: summary.stats.signedDocuments, subtitle: dateFilter === "all" ? "Todo o histórico" : "No período", icon: Archive, tone: "text-slate-500" },
            { title: "CAs em atenção", value: summary.stats.criticalCAs, subtitle: "Vencidos ou até 90 dias", icon: AlertTriangle, tone: summary.stats.criticalCAs > 0 ? "text-amber-600" : "text-slate-500" },
          ].map((metric) => (
            <section key={metric.title} aria-label={metric.title} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="mb-5 flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold leading-5 text-slate-600">{metric.title}</h2>
                <metric.icon className={`h-4 w-4 shrink-0 ${metric.tone}`} aria-hidden="true" />
              </div>
              <p className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">{numberFormat.format(metric.value)}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">{metric.subtitle}</p>
            </section>
          ))}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="mb-6">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">Atividade de entregas</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{chartCaption}</p>
            </div>
            {chartHasActivity ? <div role="img" aria-label={`Gráfico de entregas com ${chartData.length} dias; ${chartData.reduce((total, bucket) => total + bucket.value, 0)} entregas na janela exibida.`} className="h-60 min-w-0 sm:h-72">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240} initialDimension={{ width: 320, height: 240 }}>
                <AreaChart data={chartData} margin={{ top: 5, left: 0, right: 10, bottom: 5 }} accessibilityLayer>
                  <CartesianGrid vertical={false} stroke="#edf2f7" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 11 }} tickMargin={12} interval="preserveStartEnd" />
                  <YAxis width={30} allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 11 }} />
                  <Tooltip formatter={(value) => [value ?? 0, "Entregas"]} contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: "12px", boxShadow: "0 4px 12px rgb(15 23 42 / 0.06)" }} />
                  <Area type="monotone" dataKey="value" stroke={activeBrand.primaryColor} strokeWidth={2} fill={activeBrand.primaryColor} fillOpacity={0.06} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div> : (
              <div className="flex min-h-60 flex-col items-center justify-center rounded-xl bg-slate-50 px-5 text-center">
                <PackageCheck className="mb-3 h-7 w-7 text-slate-400" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-700">Nenhuma entrega na janela do gráfico</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Selecione outro período ou registre a próxima entrega.</p>
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
              <span>Dados da última consulta</span>
              <span role="status">{refreshing ? "Atualizando indicadores…" : updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
            </div>
          </section>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5 sm:px-6">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">Últimas entregas</h2>
              <p className="mt-1 text-xs text-slate-500">Os cinco registros mais recentes no período.</p>
            </div>
            {summary.recentDeliveries.length ? (
              <ul className="divide-y divide-slate-100">
                {summary.recentDeliveries.map((delivery) => (
                  <li key={delivery.id} className="px-5 py-4 sm:px-6">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <p className="min-w-0 break-words text-sm font-semibold leading-5 text-slate-800">{delivery.employee?.full_name || "Colaborador não disponível"}</p>
                      <span className="shrink-0 font-mono text-[11px] leading-5 text-slate-400">#{delivery.id.slice(0, 6)}</span>
                    </div>
                    <p className="mt-1 break-words text-xs leading-5 text-slate-500">{delivery.ppe?.name || "Equipamento não disponível"}</p>
                    <p className="mt-2 text-xs text-slate-400">{formatDeliveryDate(delivery.delivery_date)}</p>
                  </li>
                ))}
              </ul>
            ) : <div className="px-6 py-12 text-center text-sm leading-6 text-slate-500">Nenhuma entrega registrada neste período.</div>}
            <div className="border-t border-slate-100 p-3">
              <Link href="/history" className={`flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 text-sm font-semibold text-[var(--brand-color)] transition-colors hover:bg-slate-50 ${focusStyle}`}>
                Consultar histórico completo <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </section>
        </div>
      </div>}
    </div>
  )
}
