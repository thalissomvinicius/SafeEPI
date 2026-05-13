export function getDateOnlyValue(value?: string | null) {
  return value ? value.split("T")[0] : ""
}

export function parseLocalDateOnly(value?: string | null) {
  const dateOnly = getDateOnlyValue(value)
  const [year, month, day] = dateOnly.split("-").map(Number)

  if (year && month && day) {
    return new Date(year, month - 1, day)
  }

  return null
}

export function toLocalDeliveryDateISOString(value?: string | null, timeSource = new Date()) {
  const dateOnly = getDateOnlyValue(value)
  const [year, month, day] = dateOnly.split("-").map(Number)

  if (year && month && day) {
    return new Date(
      year,
      month - 1,
      day,
      timeSource.getHours(),
      timeSource.getMinutes(),
      timeSource.getSeconds(),
      timeSource.getMilliseconds()
    ).toISOString()
  }

  return timeSource.toISOString()
}

function isUtcMidnightTimestamp(value?: string | null) {
  if (!value || !value.includes("T")) return false

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false

  return (
    parsed.getUTCHours() === 0 &&
    parsed.getUTCMinutes() === 0 &&
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0
  )
}

export function parseDeliveryDateTime(value?: string | null) {
  if (!value) return null

  if (isUtcMidnightTimestamp(value)) {
    return parseLocalDateOnly(value)
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? parseLocalDateOnly(value) : parsed
}

export function formatDeliveryDate(value?: string | null) {
  const date = parseDeliveryDateTime(value)
  return date ? date.toLocaleDateString("pt-BR") : "-"
}

export function formatDeliveryTime(value?: string | null) {
  const date = parseDeliveryDateTime(value)
  return date
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "--:--"
}

export function formatDateOnly(value?: string | null) {
  const date = parseLocalDateOnly(value)
  return date ? date.toLocaleDateString("pt-BR") : "-"
}

export function getDaysUntilDateOnly(value?: string | null) {
  const date = parseLocalDateOnly(value)
  if (!date) return Number.POSITIVE_INFINITY

  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.ceil((date.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24))
}

export function isDateOnlyPast(value?: string | null) {
  return getDaysUntilDateOnly(value) < 0
}
