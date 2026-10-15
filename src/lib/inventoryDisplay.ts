import { format, isValid, parseISO } from "date-fns"
import { ptBR } from "date-fns/locale"

/** CA validity is a calendar day, even when legacy data includes a timestamp. */
export function formatInventoryExpiry(value?: string | null) {
  if (!value) return "—"
  const datePart = value.match(/^\d{4}-\d{2}-\d{2}(?=$|T|\s)/)?.[0]
  if (!datePart) return "Data inválida"
  const date = parseISO(datePart)
  return isValid(date) ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "Data inválida"
}

/** Missing legacy audit timestamps must not crash the stock page or invent a time. */
export function formatInventoryMovementDate(value?: string | null) {
  if (!value) return "Data não informada"
  const date = parseISO(value)
  if (!isValid(date)) return "Data inválida"
  return format(date, /^\d{4}-\d{2}-\d{2}$/.test(value) ? "dd/MM/yyyy" : "dd/MM/yyyy • HH:mm", { locale: ptBR })
}
