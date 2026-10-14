import { describe, expect, it, vi } from "vitest"
import { createDeliveryOperation, deliveryOperationStorageKey, readDeliveryOperation, runDeliveryOperation } from "@/lib/deliveryOperation"

function operation() {
  return createDeliveryOperation({ employeeId: "employee", workplaceId: "workplace", thirdPartyId: null,
    deliveryDate: "2026-10-13T12:00:00Z", mode: "signed", authMethod: "manual", fingerprintEventId: null,
    items: [{ ppeId: "gloves", quantity: 2, reason: "Primeira Entrega", returns: [] }, { ppeId: "boots", quantity: 1, reason: "Dano", returns: [] }],
  })
}

describe("recoverable delivery operation", () => {
  it("resumes after item two failed without creating item one again, with the exact same key", async () => {
    const current = operation()
    const keys: string[] = []
    let failing = true
    const create = vi.fn(async (item) => {
      keys.push(item.key)
      if (item.ppeId === "boots" && failing) throw new Error("response lost")
      return { id: item.ppeId }
    })
    const callbacks = { persist: vi.fn(), create, read: vi.fn(async (id: string) => ({ id })), returnedQuantity: vi.fn(), returnItem: vi.fn() }
    await expect(runDeliveryOperation(current, callbacks)).rejects.toThrow("response lost")
    expect(current.items[0].deliveryId).toBe("gloves")
    failing = false
    expect(await runDeliveryOperation(current, callbacks)).toEqual([{ id: "gloves" }, { id: "boots" }])
    expect(keys).toEqual([current.items[0].key, current.items[1].key, current.items[1].key])
    expect(callbacks.persist.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
  })

  it("never retries an ambiguous previous return and reconciles only its exact target", async () => {
    const current = operation()
    current.items[0].returns.push({ deliveryId: "old", quantity: 2, baseline: 1, state: "pending" })
    const callbacks = { persist: vi.fn(), create: vi.fn(async (item) => ({ id: item.ppeId })), read: vi.fn(async (id: string) => ({ id })), returnedQuantity: vi.fn(async () => 1), returnItem: vi.fn(async () => { throw new Error("timeout") }) }
    await expect(runDeliveryOperation(current, callbacks)).rejects.toThrow("timeout")
    await expect(runDeliveryOperation(current, callbacks)).rejects.toThrow("resultado incerto")
    expect(callbacks.returnItem).toHaveBeenCalledTimes(1)
    callbacks.returnedQuantity.mockResolvedValue(3)
    await expect(runDeliveryOperation(current, callbacks)).resolves.toHaveLength(2)
    expect(callbacks.returnItem).toHaveBeenCalledTimes(1)
  })

  it("survives reload in the same scoped tab without persisting names, signatures or credentials", () => {
    const current = operation()
    current.items[0].deliveryId = "confirmed"
    const key = deliveryOperationStorageKey("operator", "company-a")
    sessionStorage.setItem(key, JSON.stringify(current))
    expect(readDeliveryOperation(sessionStorage, key)).toEqual(current)
    expect(readDeliveryOperation(sessionStorage, deliveryOperationStorageKey("operator", "company-b"))).toBeNull()
    expect(JSON.stringify(current)).not.toMatch(/signature_url|token|cpf|full_name|data:image/)
  })

  it("does not issue any mutation when the journal cannot be stored", async () => {
    const create = vi.fn()
    await expect(runDeliveryOperation(operation(), { persist: () => { throw new Error("storage unavailable") }, create, read: vi.fn(), returnedQuantity: vi.fn(), returnItem: vi.fn() })).rejects.toThrow("storage unavailable")
    expect(create).not.toHaveBeenCalled()
  })

  it("keeps an unexpected return quantity pending for review rather than reporting a complete replacement", async () => {
    const current = operation()
    current.items[0].returns.push({ deliveryId: "old", quantity: 2, baseline: 1, state: "pending" })
    const callbacks = { persist: vi.fn(), create: vi.fn(async (item) => ({ id: item.ppeId })), read: vi.fn(), returnedQuantity: vi.fn(async () => 2), returnItem: vi.fn(async () => ({ ok: true, returned_quantity: 2, quantity_returned_now: 1 })) }
    await expect(runDeliveryOperation(current, callbacks)).rejects.toThrow("quantidade diferente")
    expect(current.items[0].returns[0].state).toBe("sending")
    expect(callbacks.create).toHaveBeenCalledTimes(1)
  })

  it("marks an exact return result as complete", async () => {
    const current = operation()
    current.items[0].returns.push({ deliveryId: "old", quantity: 2, baseline: 1, state: "pending" })
    await runDeliveryOperation(current, { persist: vi.fn(), create: vi.fn(async (item) => ({ id: item.ppeId })), read: vi.fn(), returnedQuantity: vi.fn(), returnItem: vi.fn(async () => ({ ok: true, returned_quantity: 3, quantity_returned_now: 2 })) })
    expect(current.items[0].returns[0].state).toBe("done")
  })

  it("retains the persisted operation key after a post-commit journal write fails", async () => {
    const current = operation()
    let stored = ""
    const create = vi.fn(async (item) => ({ id: item.ppeId }))
    const persist = vi.fn((value) => {
      if (value.items[0].deliveryId) throw new Error("quota changed")
      stored = JSON.stringify(value)
    })
    await expect(runDeliveryOperation(current, { persist, create, read: vi.fn(), returnedQuantity: vi.fn(), returnItem: vi.fn() })).rejects.toThrow("quota changed")
    const recovered = readDeliveryOperation({ getItem: () => stored }, "journal")!
    expect(recovered.items[0].key).toBe(current.items[0].key)
    expect(recovered.items[0].deliveryId).toBeNull()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("reports damaged local JSON without discarding the recovery record", () => {
    const storage = { getItem: vi.fn(() => "{broken") }
    expect(() => readDeliveryOperation(storage, "journal")).toThrow("Consulte o historico")
  })
})
