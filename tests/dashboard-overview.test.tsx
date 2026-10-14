import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { axe } from "jest-axe"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DashboardOverview } from "@/components/dashboard/DashboardOverview"
import { getDashboardDateRange } from "@/components/dashboard/dashboardFilters"
import type { DashboardSummary } from "@/services/api"

const mocks = vi.hoisted(() => ({ getDashboardSummary: vi.fn() }))
vi.mock("@/services/api", () => ({ api: { getDashboardSummary: mocks.getDashboardSummary } }))
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator", role: "ADMIN" } }) }))
vi.mock("@/hooks/useActiveBrand", () => ({ useActiveBrand: () => ({ primaryColor: "#9f2028" }) }))

const summary: DashboardSummary = {
  stats: { deliveries: 137, employees: 86, criticalCAs: 3, lowStock: 7, signedDocuments: 116 },
  employeeCounts: { own: 86, third_party: 23, all: 109 },
  recentDeliveries: [{ id: "delivery-43", delivery_date: "2026-10-12T13:30:00Z", employee: { full_name: "MARCOS VINÍCIUS DE OLIVEIRA" }, ppe: { name: "LUVA DE PROTEÇÃO" } }],
  chartData: [],
}

describe("DashboardOverview", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getDashboardSummary.mockResolvedValue(summary) })
  afterEach(cleanup)

  it("keeps the main action usable while metrics load", async () => {
    mocks.getDashboardSummary.mockImplementation(() => new Promise(() => {}))
    render(<DashboardOverview />)
    expect(screen.getByRole("link", { name: "Nova entrega" })).toHaveAttribute("href", "/delivery")
    expect(screen.getByRole("status", { name: "Carregando indicadores" })).toBeVisible()
    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })

  it("uses factual status and accessible labeled filters", async () => {
    const { container } = render(<DashboardOverview />)
    await screen.findByText("137")
    expect(screen.getByLabelText("Período das entregas e PDFs")).toBeVisible()
    expect(screen.getByRole("button", { name: "Próprios 86" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("MARCOS VINÍCIUS DE OLIVEIRA")).toBeVisible()
    expect(screen.queryByText("Assinado")).not.toBeInTheDocument()
    expect(screen.queryByText("Live Sync")).not.toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it("retains previously loaded values when a refresh fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<DashboardOverview />)
    await screen.findByText("137")
    mocks.getDashboardSummary.mockRejectedValueOnce(new Error("Network unavailable"))
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Mantivemos a última consulta")
    expect(screen.getByText("137")).toBeVisible()
    consoleError.mockRestore()
  })

  it("does not replace an earlier response with a cancelled request's stale result", async () => {
    let resolveFirst!: (value: DashboardSummary) => void
    mocks.getDashboardSummary.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    render(<DashboardOverview />)
    fireEvent.change(screen.getByLabelText("Período das entregas e PDFs"), { target: { value: "last30" } })
    await screen.findByText("137")
    await act(async () => { resolveFirst({ ...summary, stats: { ...summary.stats, deliveries: 999 } }) })
    expect(screen.getByText("137")).toBeVisible()
    expect(screen.queryByText("999")).not.toBeInTheDocument()
  })

  it("requires a complete valid custom range before querying", async () => {
    render(<DashboardOverview />)
    await screen.findByText("137")
    fireEvent.change(screen.getByLabelText("Período das entregas e PDFs"), { target: { value: "custom" } })
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-01-01" } })
    expect(mocks.getDashboardSummary).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-10-12" } })
    await waitFor(() => expect(mocks.getDashboardSummary).toHaveBeenCalledTimes(2))
    const filters = mocks.getDashboardSummary.mock.calls[1][0]
    expect(new Date(filters.chartEnd).getTime() - new Date(filters.chartStart).getTime()).toBeLessThan(32 * 86400000)
    expect(new Date(filters.start).getFullYear()).toBe(2026)
    expect(new Date(filters.start).getMonth()).toBe(0)
  })
})

describe("Dashboard date ranges", () => {
  it("rejects missing, invalid or reversed custom dates", () => {
    expect(getDashboardDateRange("custom", "", "2026-10-12")).toMatch(/duas datas/)
    expect(getDashboardDateRange("custom", "invalid", "2026-10-12")).toMatch(/válidas/)
    expect(getDashboardDateRange("custom", "2026-10-12", "2026-10-01")).toMatch(/anterior/)
  })

  it("clamps a long chart window without changing historical totals", () => {
    const range = getDashboardDateRange("custom", "2026-01-01", "2026-10-12")
    expect(typeof range).toBe("object")
    if (typeof range === "string") return
    expect(range.chartIsLimited).toBe(true)
    expect(new Date(range.start).getMonth()).toBe(0)
    expect(new Date(range.chartStart).getMonth()).toBe(8)
    expect(new Date(range.chartEnd).getTime() - new Date(range.chartStart).getTime()).toBeLessThan(32 * 86400000)
  })

  it("preserves seven-day, month, thirty-day and all-history modes", () => {
    const now = new Date("2026-10-13T15:00:00")
    for (const filter of ["last7", "month", "last30", "all"] as const) {
      const range = getDashboardDateRange(filter, "", "", now)
      expect(typeof range).toBe("object")
      if (typeof range === "string") continue
      expect(range.allHistory).toBe(filter === "all")
      expect(new Date(range.chartEnd).getTime() - new Date(range.chartStart).getTime()).toBeLessThan(32 * 86400000)
    }
  })
})
