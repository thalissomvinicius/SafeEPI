/** Only retry a known, missing optional column, never permission or network errors. */
export function isMissingDatabaseColumn(error: unknown, column: string): boolean {
  if (!error || typeof error !== "object" || !/^[a-z_][a-z0-9_]*$/.test(column)) return false
  const value = error as { code?: string; message?: string; details?: string | null; hint?: string | null }
  if (value.code !== "42703" && value.code !== "PGRST204") return false
  const text = `${value.message || ""} ${value.details || ""} ${value.hint || ""}`.toLowerCase()
  return new RegExp(`\\b${column}\\b`).test(text)
}
