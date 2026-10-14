import { z } from "zod"

const returnStep = z.object({
  deliveryId: z.string(), quantity: z.number().int().positive(), baseline: z.number().nonnegative(),
  state: z.enum(["pending", "sending", "done"]),
})
const item = z.object({
  ppeId: z.string(), quantity: z.number().int().positive(), reason: z.string(),
  key: z.string(), deliveryId: z.string().nullable(), returns: z.array(returnStep),
})
const schema = z.object({
  version: z.literal(1), id: z.string(), employeeId: z.string(), workplaceId: z.string(),
  thirdPartyId: z.string().nullable(), deliveryDate: z.string(),
  mode: z.enum(["signed", "later"]), authMethod: z.enum(["manual", "manual_facial", "fingerprint"]),
  fingerprintEventId: z.string().nullable(), items: z.array(item).min(1),
})
export type DeliveryOperation = z.infer<typeof schema>
export type DeliveryOperationItem = DeliveryOperation["items"][number]

export function deliveryOperationStorageKey(userId: string, companyId: string) {
  return `safeepi:delivery-operation:v1:${userId}:${companyId}`
}

// IDs and quantities only: no employee names, CPF, images, credentials or signed URLs.
export function readDeliveryOperation(storage: Pick<Storage, "getItem">, key: string): DeliveryOperation | null {
  const raw = storage.getItem(key)
  if (!raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch {
    throw new Error("O pedido em recuperacao nao pode ser lido. Consulte o historico antes de iniciar outra entrega.")
  }
  const result = schema.safeParse(value)
  if (!result.success) throw new Error("O pedido em recuperacao nao pode ser lido. Consulte o historico antes de iniciar outra entrega.")
  return result.data
}

export function createDeliveryOperation(input: Omit<DeliveryOperation, "version" | "id" | "items"> & {
  items: { ppeId: string; quantity: number; reason: string; returns: { deliveryId: string; quantity: number; baseline: number }[] }[]
}): DeliveryOperation {
  const id = crypto.randomUUID()
  return { ...input, version: 1, id, items: input.items.map((entry, index) => ({
    ...entry, key: `${id}:${index}`, deliveryId: null,
    returns: entry.returns.map((allocation) => ({ ...allocation, state: "pending" })),
  })) }
}

export async function runDeliveryOperation<T extends { id: string }>(operation: DeliveryOperation, callbacks: {
  persist: (operation: DeliveryOperation) => void
  create: (item: DeliveryOperationItem, index: number) => Promise<T>
  read: (id: string) => Promise<T | undefined>
  returnedQuantity: (id: string) => Promise<number>
  returnItem: (step: DeliveryOperationItem["returns"][number], item: DeliveryOperationItem) => Promise<unknown>
}): Promise<T[]> {
  const deliveries: T[] = []
  // Persist the full intention BEFORE the first mutation, including every stable key.
  callbacks.persist(operation)
  for (const [index, entry] of operation.items.entries()) {
    const delivery = entry.deliveryId ? await callbacks.read(entry.deliveryId) : await callbacks.create(entry, index)
    if (!delivery) throw new Error("A entrega confirmada nao foi localizada. Consulte o historico antes de continuar.")
    entry.deliveryId = delivery.id
    callbacks.persist(operation)
    deliveries.push(delivery)
    for (const step of entry.returns) {
      if (step.state === "done" || step.deliveryId === delivery.id) continue
      if (step.state === "sending") {
        const current = await callbacks.returnedQuantity(step.deliveryId)
        if (current !== step.baseline + step.quantity) {
          throw new Error("A entrega ja foi registrada, mas a baixa anterior tem resultado incerto. Confira a devolucao no historico antes de continuar; ela nao sera repetida automaticamente.")
        }
      } else {
        step.state = "sending"
        callbacks.persist(operation)
        const result = await callbacks.returnItem(step, entry) as {
          ok?: boolean; returned_quantity?: number; quantity_returned_now?: number
        } | undefined
        // The RPC can clamp the amount when another operator changes the balance
        // after the API precheck. Never mark that as the full requested return.
        if (!result?.ok || result.quantity_returned_now !== step.quantity || result.returned_quantity !== step.baseline + step.quantity) {
          throw new Error("A baixa anterior retornou uma quantidade diferente da solicitada. Confira o historico antes de continuar; ela nao sera repetida automaticamente.")
        }
      }
      step.state = "done"
      callbacks.persist(operation)
    }
  }
  return deliveries
}
