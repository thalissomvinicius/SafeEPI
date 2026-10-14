export const LOW_STOCK_THRESHOLD = 5

export function isValidStockQuantity(type: string, quantity: number) {
  return Number.isInteger(quantity) && quantity >= 0 && (type === "AJUSTE" || quantity > 0)
}
