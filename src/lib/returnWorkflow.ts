import type { Delivery } from "@/types/database"

type ReturnState = Pick<Delivery, "id" | "employee_id" | "quantity" | "returned_quantity" | "returned_at" | "return_motive">

export function outstandingReturnQuantity(delivery: Pick<Delivery, "quantity" | "returned_quantity" | "returned_at">): number {
  if (delivery.returned_at) return 0
  return Math.max(0, Number(delivery.quantity || 0) - Number(delivery.returned_quantity || 0))
}

/** Reuse requires an explicit operator decision; a reason never grants it by itself. */
export function canRestockReturn(motive: string): boolean {
  const normalized = motive.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()
  return ["demissao", "erro de entrega", "devolucao", "devolucao em boas condicoes"].includes(normalized)
}

export function replacementReason(motive: string): Delivery["reason"] {
  if (motive === "Perda") return "Perda"
  if (motive === "Dano") return "Dano"
  return "Substituição (Desgaste/Validade)"
}

export interface ReturnOperationProgress {
  attempted: boolean
  confirmed: boolean
  replacementId?: string
}

export interface ReturnResult {
  ok?: boolean
  returned_quantity?: number
  quantity_returned_now?: number
}

/**
 * The existing RPC has no operation key for partial returns. This screen returns
 * the full outstanding balance and never repeats a confirmed return on PDF or
 * replacement failure. Ambiguous partial/concurrent changes require review.
 */
export async function confirmWholeReturn(
  original: ReturnState,
  employeeId: string,
  motive: string,
  progress: ReturnOperationProgress,
  readCurrent: () => Promise<ReturnState | undefined>,
  returnCurrent: () => Promise<ReturnResult>,
): Promise<void> {
  if (original.employee_id !== employeeId) throw new Error("A entrega não pertence ao colaborador selecionado.")
  if (progress.confirmed) return
  const baseline = Number(original.returned_quantity || 0)
  const quantity = outstandingReturnQuantity(original)
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Este item não possui saldo para baixa.")

  if (progress.attempted) {
    const current = await readCurrent()
    if (!current || current.employee_id !== employeeId) throw new Error("Não foi possível conferir a baixa. Atualize o histórico antes de continuar.")
    const returned = Number(current.returned_quantity || 0)
    if (returned >= Number(original.quantity) && current.return_motive === motive) {
      progress.confirmed = true
      return
    }
    if (returned !== baseline || current.returned_at) {
      throw new Error("O saldo desta entrega mudou durante a tentativa. Confira o histórico; a baixa não será repetida automaticamente.")
    }
  }

  progress.attempted = true
  const result = await returnCurrent()
  if (!result.ok || result.quantity_returned_now !== quantity || result.returned_quantity !== baseline + quantity) {
    throw new Error("A baixa retornou uma quantidade diferente da solicitada. Confira o histórico antes de continuar.")
  }
  progress.confirmed = true
}
