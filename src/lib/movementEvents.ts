import type { DeliveryWithRelations } from "@/types/database"
import { parseDeliveryDateTime } from "@/lib/dateOnly"

export const MOVEMENT_HISTORY_NOTE = "Devoluções são exibidas pela data de conclusão. A quantidade da devolução é o total acumulado da entrega; o histórico legado não informa as datas e quantidades de cada parcela."

export type MovementEvent = DeliveryWithRelations & {
  event_id: string
  event_type: "delivery" | "return"
  event_date: string
  event_quantity: number
}

/** Original delivery fields stay intact for receipts and signature actions. */
export function buildMovementEvents(deliveries: DeliveryWithRelations[]): MovementEvent[] {
  return deliveries.flatMap((delivery) => {
    const events: MovementEvent[] = [{
      ...delivery,
      event_id: `${delivery.id}:delivery`,
      event_type: "delivery",
      event_date: delivery.delivery_date,
      event_quantity: delivery.quantity,
    }]
    if (delivery.returned_at && Number.isFinite(new Date(delivery.returned_at).getTime())) {
      events.push({
        ...delivery,
        event_id: `${delivery.id}:return`,
        event_type: "return",
        event_date: delivery.returned_at,
        event_quantity: Math.min(delivery.quantity, delivery.returned_quantity ?? delivery.quantity),
      })
    }
    return events
  })
}

export type MovementReportRow = DeliveryWithRelations & Partial<Pick<MovementEvent, "event_id" | "event_type" | "event_date" | "event_quantity">>
export const movementEventLabel = (row: MovementReportRow) => row.event_type === "return" ? "Devolução concluída" : "Entrega"
export const movementEventDate = (row: MovementReportRow) => row.event_date || row.delivery_date
export const movementEventQuantity = (row: MovementReportRow) => row.event_quantity ?? row.quantity
export const movementEventTime = (row: MovementReportRow) => row.event_type === "return"
  ? new Date(movementEventDate(row)).getTime()
  : parseDeliveryDateTime(movementEventDate(row))?.getTime() ?? Number.NaN

export function summarizeMovementEvents(events: MovementEvent[]) {
  return {
    deliveries: events.filter((event) => event.event_type === "delivery").length,
    returns: events.filter((event) => event.event_type === "return").length,
    // Returned quantities are cumulative legacy values, not dated increments.
    totalItems: events.filter((event) => event.event_type === "delivery").reduce((sum, event) => sum + event.event_quantity, 0),
    uniqueEmployees: new Set(events.map((event) => event.employee_id)).size,
  }
}
