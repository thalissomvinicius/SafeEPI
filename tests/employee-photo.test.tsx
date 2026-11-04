import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EmployeePhoto } from "@/components/employees/EmployeePhoto"

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock("@/services/api", () => ({ api: { getEmployeePhotoUrl: mocks.resolve } }))
let observers: Array<{ callback: IntersectionObserverCallback; target?: Element; disconnected: boolean }>
beforeEach(() => {
  vi.clearAllMocks()
  observers = []
  vi.stubGlobal("IntersectionObserver", class {
    entry: typeof observers[number]
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback, disconnected: false }; observers.push(this.entry) }
    observe(target: Element) { this.entry.target = target }
    disconnect() { this.entry.disconnected = true }
  })
  mocks.resolve.mockResolvedValue("https://example.org/signed-photo")
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function intersect(index = 0) {
  const observer = observers[index]
  act(() => observer.callback([{ isIntersecting: true, target: observer.target } as IntersectionObserverEntry], {} as IntersectionObserver))
}

describe("employee photo previews", () => {
  it("does not request hidden/offscreen previews and resolves an observed photo once", async () => {
    render(<><EmployeePhoto value="company/photo1.png" alt="Pessoa 1" /><EmployeePhoto value="company/photo2.png" alt="Pessoa 2" /></>)
    expect(mocks.resolve).not.toHaveBeenCalled()
    intersect()
    intersect()
    expect(await screen.findByRole("img", { name: "Pessoa 1" })).toHaveAttribute("src", "https://example.org/signed-photo")
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
    expect(mocks.resolve).toHaveBeenCalledWith("company/photo1.png")
    expect(screen.getByRole("img", { name: "Foto indisponível de Pessoa 2" })).toBeInTheDocument()
  })

  it("keeps the fallback usable when storage fails or the image cannot load", async () => {
    mocks.resolve.mockRejectedValueOnce(new Error("Too many requests"))
    const { rerender } = render(<EmployeePhoto value="company/missing.png" alt="Pessoa" />)
    intersect()
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    expect(screen.getByRole("img", { name: "Foto indisponível de Pessoa" })).toBeInTheDocument()
    rerender(<EmployeePhoto value="https://example.org/public.png" alt="Pessoa" />)
    const image = screen.getByRole("img", { name: "Pessoa" })
    fireEvent.error(image)
    expect(screen.getByRole("img", { name: "Foto indisponível de Pessoa" })).toBeInTheDocument()
  })

  it("ignores a previous person's delayed photo after switching source", async () => {
    let finish!: (value: string) => void
    mocks.resolve.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { rerender } = render(<EmployeePhoto value="company/person1.png" alt="Pessoa 1" />)
    intersect()
    rerender(<EmployeePhoto value="company/person2.png" alt="Pessoa 2" />)
    intersect(1)
    expect(await screen.findByRole("img", { name: "Pessoa 2" })).toHaveAttribute("src", "https://example.org/signed-photo")
    await act(async () => { finish("https://example.org/old-person") })
    expect(screen.getByRole("img", { name: "Pessoa 2" })).toHaveAttribute("src", "https://example.org/signed-photo")
  })
})
