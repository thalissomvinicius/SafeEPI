export type DashboardDateFilter = "last7" | "month" | "last30" | "custom" | "all"

export type DashboardDateRange = {
  allHistory: boolean
  start: string
  end: string
  chartStart: string
  chartEnd: string
  chartIsLimited: boolean
}

export function getDashboardDateRange(
  filter: DashboardDateFilter,
  customStart: string,
  customEnd: string,
  now = new Date(),
): DashboardDateRange | string {
  let start: Date | null = null
  let end = new Date(now)

  if (filter === "custom") {
    if (!customStart || !customEnd) return "Informe as duas datas para aplicar o período."
    start = new Date(`${customStart}T00:00:00`)
    end = new Date(`${customEnd}T23:59:59.999`)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return "Informe datas válidas."
    if (start > end) return "A data inicial deve ser anterior ou igual à data final."
  } else if (filter === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
  } else if (filter === "last7" || filter === "last30") {
    start = new Date(now)
    start.setDate(start.getDate() - (filter === "last7" ? 6 : 29))
    start.setHours(0, 0, 0, 0)
  }

  // Bound the chart without truncating the period used by the totals.
  // The API deliberately limits chart buckets to a maximum of 32 days.
  const chartWindowStart = new Date(end)
  chartWindowStart.setDate(chartWindowStart.getDate() - 29)
  chartWindowStart.setHours(0, 0, 0, 0)
  const chartStart = start && start > chartWindowStart ? start : chartWindowStart

  return {
    allHistory: filter === "all",
    start: (start || new Date(0)).toISOString(),
    end: end.toISOString(),
    chartStart: chartStart.toISOString(),
    chartEnd: end.toISOString(),
    chartIsLimited: !start || chartStart > start,
  }
}
