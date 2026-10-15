import { describe, expect, it } from "vitest"
import { formatInventoryExpiry, formatInventoryMovementDate } from "@/lib/inventoryDisplay"

describe("inventory date presentation", () => {
  it.each(["2027-04-20", "2027-04-20T00:00:00.000Z", "2027-04-20 00:00:00+00"]) (
    "keeps a CA calendar day for %s", (value) => expect(formatInventoryExpiry(value)).toBe("20/04/2027"),
  )
  it.each(["not-a-date", "2026-02-30", "2026-13-01", "infinity"]) (
    "labels invalid persisted dates without throwing (%s)", (value) => {
      expect(formatInventoryExpiry(value)).toBe("Data inválida")
      expect(formatInventoryMovementDate(value)).toBe("Data inválida")
    },
  )
  it("shows absence honestly and does not invent a time for date-only movements", () => {
    expect(formatInventoryExpiry(null)).toBe("—")
    expect(formatInventoryMovementDate(undefined)).toBe("Data não informada")
    expect(formatInventoryMovementDate("2026-10-15")).toBe("15/10/2026")
  })
  it("preserves the timestamp's actual instant in local time", () => {
    const date = new Date("2026-10-15T12:34:00Z")
    const localTime = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    expect(formatInventoryMovementDate(date.toISOString())).toContain(`• ${localTime}`)
  })
})
