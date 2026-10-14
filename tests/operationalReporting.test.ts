import { describe, expect, it } from "vitest"
import { buildMovementEvents, movementEventTime, summarizeMovementEvents } from "@/lib/movementEvents"
import { getReportPeriod, timestampInReportPeriod } from "@/lib/reportPeriod"
import { isValidStockQuantity } from "@/lib/stockPolicy"
import { mapConcurrent } from "@/lib/mapConcurrent"
import type { DeliveryWithRelations } from "@/types/database"

const delivery: DeliveryWithRelations = {
  id: "delivery-1", employee_id: "employee-1", ppe_id: "ppe-1", quantity: 3,
  delivery_date: "2026-09-12T12:00:00Z", returned_at: "2026-10-02T12:00:00Z", returned_quantity: 3,
  reason: "Primeira Entrega", signature_url: "company/signature.png", ip_address: null, workplace_id: null,
}

describe("eventos de movimentação sem inventar datas do histórico legado", () => {
  it("preserva a entrega em setembro e exibe a conclusão da devolução em outubro", () => {
    const events = buildMovementEvents([delivery])
    const september = events.filter((event) => timestampInReportPeriod(movementEventTime(event), getReportPeriod("specific_month", "", "", "2026-09")))
    const october = events.filter((event) => timestampInReportPeriod(movementEventTime(event), getReportPeriod("specific_month", "", "", "2026-10")))
    expect(september.map((event) => event.event_type)).toEqual(["delivery"])
    expect(october.map((event) => event.event_type)).toEqual(["return"])
    expect(october[0].delivery_date).toBe(delivery.delivery_date)
    expect(october[0].signature_url).toBe(delivery.signature_url)
    expect(summarizeMovementEvents(events)).toEqual({ deliveries: 1, returns: 1, totalItems: 3, uniqueEmployees: 1 })
    expect(summarizeMovementEvents(october).totalItems).toBe(0)
  })

  it("não cria um evento datado para devolução parcial sem returned_at", () => {
    expect(buildMovementEvents([{ ...delivery, returned_at: null, returned_quantity: 1 }])).toHaveLength(1)
  })

  it("não usa a data da entrega quando returned_at é inválido", () => {
    expect(buildMovementEvents([{ ...delivery, returned_at: "invalid" }])).toHaveLength(1)
  })
})

describe("períodos de relatório", () => {
  it.each([["", "2026-10-31"], ["2026-10-15", ""], ["2026-10-15", "2026-10-01"], ["2026-02-30", "2026-03-01"]])("rejeita faixa incompleta, invertida ou data inexistente (%s / %s)", (start, end) => {
    expect(getReportPeriod("custom", start, end).valid).toBe(false)
  })

  it("inclui até o último milissegundo do último dia local", () => {
    const period = getReportPeriod("custom", "2026-10-01", "2026-10-31")
    expect(timestampInReportPeriod(new Date(2026, 9, 31, 23, 59, 59, 999).getTime(), period)).toBe(true)
    expect(timestampInReportPeriod(new Date(2026, 10, 1).getTime(), period)).toBe(false)
  })
})

describe("quantidade de estoque", () => {
  it("aceita saldo zero somente como ajuste absoluto", () => {
    expect(isValidStockQuantity("AJUSTE", 0)).toBe(true)
    expect(isValidStockQuantity("ENTRADA", 0)).toBe(false)
    expect(isValidStockQuantity("SAIDA", 0)).toBe(false)
  })
  it.each([1.5, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejeita quantidade não inteira válida: %s", (quantity) => {
    expect(isValidStockQuantity("AJUSTE", quantity)).toBe(false)
  })
})

describe("carregamento de evidências do PDF", () => {
  it("mantém ordem sem ultrapassar quatro arquivos simultâneos", async () => {
    let running = 0
    let peak = 0
    const output = await mapConcurrent(Array.from({ length: 21 }, (_, index) => index), 4, async (index) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, index % 3))
      running--
      return index * 2
    })
    expect(peak).toBe(4)
    expect(output).toEqual(Array.from({ length: 21 }, (_, index) => index * 2))
  })
  it("falha explicitamente em vez de omitir uma evidência", async () => {
    await expect(mapConcurrent([1, 2, 3], 1, async (index) => {
      if (index === 2) throw new Error("Assinatura indisponível")
      return index
    })).rejects.toThrow("Assinatura indisponível")
  })
})
