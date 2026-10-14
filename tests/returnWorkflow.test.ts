import { describe, expect, it, vi } from "vitest"
import { canRestockReturn, confirmWholeReturn, outstandingReturnQuantity, replacementReason, type ReturnOperationProgress } from "@/lib/returnWorkflow"

const original = { id: "delivery-a", employee_id: "employee-a", quantity: 5, returned_quantity: 2, returned_at: null, return_motive: null }
const progress = (): ReturnOperationProgress => ({ attempted: false, confirmed: false })

describe("recuperação de baixa e reposição", () => {
  it("considera o saldo restante e não transforma dano em perda", () => {
    expect(outstandingReturnQuantity(original)).toBe(3)
    expect(outstandingReturnQuantity({ ...original, returned_at: "2026-10-13" })).toBe(0)
    expect(replacementReason("Dano")).toBe("Dano")
    expect(replacementReason("Perda")).toBe("Perda")
  })

  it.each(["Desgaste/Validade", "Dano", "Perda", "Vencimento", "quebra", "demissão com dano"])("não devolve %s ao estoque disponível", motive => {
    expect(canRestockReturn(motive)).toBe(false)
  })

  it("demissão apenas admite confirmação explícita de reutilização", () => {
    expect(canRestockReturn("Demissão")).toBe(true)
    expect(canRestockReturn("Erro de Entrega")).toBe(true)
  })

  it("não repete baixa confirmada quando falha a etapa de reposição ou PDF", async () => {
    const state = progress()
    const read = vi.fn()
    const mutate = vi.fn().mockResolvedValue({ ok: true, returned_quantity: 5, quantity_returned_now: 3 })
    await confirmWholeReturn(original, "employee-a", "Dano", state, read, mutate)
    await confirmWholeReturn(original, "employee-a", "Dano", state, read, mutate)
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
  })

  it("consulta o resultado após resposta perdida e não repete a baixa integral", async () => {
    const state = progress()
    const mutate = vi.fn().mockRejectedValue(new Error("network failed"))
    const read = vi.fn().mockResolvedValue({ ...original, returned_quantity: 5, return_motive: "Dano", returned_at: "2026-10-13" })
    await expect(confirmWholeReturn(original, "employee-a", "Dano", state, read, mutate)).rejects.toThrow("network failed")
    await confirmWholeReturn(original, "employee-a", "Dano", state, read, mutate)
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(1)
    expect(state.confirmed).toBe(true)
  })

  it("interrompe após mudança parcial concorrente, sem baixar saldo outra vez", async () => {
    const state = { attempted: true, confirmed: false }
    const mutate = vi.fn()
    const read = vi.fn().mockResolvedValue({ ...original, returned_quantity: 3, return_motive: "Dano" })
    await expect(confirmWholeReturn(original, "employee-a", "Dano", state, read, mutate)).rejects.toThrow("saldo desta entrega mudou")
    expect(mutate).not.toHaveBeenCalled()
  })

  it("bloqueia troca de colaborador e resposta com quantidade divergente", async () => {
    const mutate = vi.fn().mockResolvedValue({ ok: true, returned_quantity: 5, quantity_returned_now: 0 })
    await expect(confirmWholeReturn(original, "employee-b", "Dano", progress(), vi.fn(), mutate)).rejects.toThrow("não pertence")
    expect(mutate).not.toHaveBeenCalled()
    await expect(confirmWholeReturn(original, "employee-a", "Dano", progress(), vi.fn(), mutate)).rejects.toThrow("quantidade diferente")
  })
})
