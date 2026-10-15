import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { exportDeliveriesToExcel, exportEmployeeToExcel, exportInventoryStockToExcel, exportMovementEventsToExcel } from "@/utils/excelExporter"

const mocks = vi.hoisted(() => ({ writeBuffer: vi.fn(), addRow: vi.fn() }))
vi.mock("exceljs", () => ({ default: { Workbook: class {
  xlsx = { writeBuffer: mocks.writeBuffer }
  addWorksheet() {
    return { addRow: mocks.addRow, getRow: () => ({}), getColumn: () => ({}), headerFooter: {} }
  }
} } }))

const exports = [
  ["deliveries", () => exportDeliveriesToExcel([])],
  ["employee", () => exportEmployeeToExcel("Colaborador de teste", [])],
  ["inventory", () => exportInventoryStockToExcel([])],
  ["movements", () => exportMovementEventsToExcel([])],
] as const

describe("Excel export completion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it.each(exports)("%s stays pending until workbook serialization and download complete", async (_, run) => {
    let resolveBuffer!: (value: ArrayBuffer) => void
    mocks.writeBuffer.mockImplementationOnce(() => new Promise<ArrayBuffer>((resolve) => { resolveBuffer = resolve }))
    const settled = vi.fn()
    const pending = run().then(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    resolveBuffer(new ArrayBuffer(0))
    await pending
    expect(settled).toHaveBeenCalledTimes(1)
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
  })

  it.each(exports)("%s propagates failed serialization to its caller", async (_, run) => {
    mocks.writeBuffer.mockRejectedValueOnce(new Error("write failed"))
    await expect(run()).rejects.toThrow("write failed")
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
  })
})
