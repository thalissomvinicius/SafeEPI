export type ReportDateFilter = "all" | "month" | "last30" | "last60" | "last90" | "custom" | "specific_month"

function parseDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

export function getReportPeriod(filter: ReportDateFilter, startInput = "", endInput = "", monthInput = "", now = new Date()) {
  if (filter === "all") return { valid: true, start: null, end: null }
  let start: Date | null = null
  let end = new Date(now)
  if (filter === "custom") {
    start = parseDateInput(startInput)
    const finalDate = parseDateInput(endInput)
    if (!start || !finalDate || start > finalDate) return { valid: false, start: null, end: null }
    end = finalDate
    end.setHours(23, 59, 59, 999)
  } else if (filter === "specific_month") {
    start = parseDateInput(`${monthInput}-01`)
    if (!start) return { valid: false, start: null, end: null }
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999)
  } else if (filter === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  } else {
    start = new Date(now)
    start.setDate(start.getDate() - Number(filter.replace("last", "")))
    start.setHours(0, 0, 0, 0)
  }
  return { valid: true, start, end }
}

export function timestampInReportPeriod(timestamp: number, period: ReturnType<typeof getReportPeriod>) {
  return period.valid && Number.isFinite(timestamp) && (!period.start || timestamp >= period.start.getTime()) && (!period.end || timestamp <= period.end.getTime())
}
