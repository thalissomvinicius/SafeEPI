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
