import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { usePdfActionDialog } from "@/hooks/usePdfActionDialog"

function Harness() {
  const { openPdfDialog, pdfActionDialog } = usePdfActionDialog()
  return <div style={{ transform: "translateZ(0)", zIndex: 90 }}>
    <button onClick={() => openPdfDialog(new Blob(["pdf"], { type: "application/pdf" }), "prontuario.pdf")}>Gerar documento</button>
    {pdfActionDialog}
  </div>
}
beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf-test"), revokeObjectURL: vi.fn() }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe("janela de PDF", () => {
  it("renderiza fora da pilha do prontuário e preserva o URL após fechar para o Safari carregar", async () => {
    vi.useFakeTimers()
    const { container, unmount } = render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Gerar documento" }))
    const dialog = screen.getByRole("dialog", { name: "Documento PDF" })
    expect(container.contains(dialog)).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pdf-test")
  })
})
