import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NotificationBell } from "@/components/layout/NotificationBell"

const mock = vi.hoisted(() => ({ getNotifications: vi.fn() }))
vi.mock("@/services/api", () => ({ api: mock }))

beforeEach(() => {
  mock.getNotifications.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe("notification feedback", () => {
  it("does not imply legal compliance when the notification list is empty", async () => {
    mock.getNotifications.mockResolvedValue([])
    const user = userEvent.setup()
    render(<NotificationBell />)
    await user.click(screen.getByRole("button", { name: /Alertas/ }))
    expect(await screen.findByText("Nenhum alerta no momento")).toBeInTheDocument()
    expect(screen.queryByText(/Tudo em conformidade/)).not.toBeInTheDocument()
  })

  it("shows a retry state rather than presenting a failed query as an empty list", async () => {
    mock.getNotifications.mockRejectedValueOnce(new Error("Synthetic network failure"))
    const user = userEvent.setup()
    render(<NotificationBell />)
    await user.click(screen.getByRole("button", { name: /Alertas/ }))
    expect(await screen.findByText("Não foi possível atualizar os alertas.")).toBeInTheDocument()
    expect(screen.queryByText("Nenhum alerta no momento")).not.toBeInTheDocument()
    mock.getNotifications.mockResolvedValueOnce([])
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }))
    await waitFor(() => expect(screen.getByText("Nenhum alerta no momento")).toBeInTheDocument())
    expect(mock.getNotifications).toHaveBeenCalledTimes(2)
  })
})
