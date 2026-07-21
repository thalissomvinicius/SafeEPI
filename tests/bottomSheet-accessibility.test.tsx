import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { BottomSheet } from "@/components/ui/BottomSheet"

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir</button>
      <BottomSheet open={open} title="Dados" onClose={() => setOpen(false)}>
        <button type="button">Acao interna</button>
      </BottomSheet>
    </>
  )
}

describe("BottomSheet accessibility", () => {
  it("moves focus into the dialog, closes with Escape and restores focus", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const opener = screen.getByRole("button", { name: "Abrir" })
    await user.click(opener)

    expect(screen.getByRole("dialog", { name: "Dados" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Fechar" })).toHaveFocus()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
