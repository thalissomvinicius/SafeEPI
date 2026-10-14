import { describe, expect, it } from "vitest"
import { formatDeliveryDate, parseDeliveryDateTime } from "@/lib/dateOnly"

describe("date-only delivery labels", () => {
  it("keeps the chosen calendar day instead of interpreting date-only values as UTC", () => {
    const date = parseDeliveryDateTime("2026-10-13")!
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(9)
    expect(date.getDate()).toBe(13)
    expect(formatDeliveryDate("2026-10-13")).toBe("13/10/2026")
  })
  it("preserves real timestamp instants", () => {
    expect(parseDeliveryDateTime("2026-10-13T17:35:00Z")?.toISOString()).toBe("2026-10-13T17:35:00.000Z")
  })
})
