import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { FacialDeliveryConfirmation } from "@/components/ui/FacialDeliveryConfirmation"

vi.mock("@/components/ui/FaceCamera", () => ({ FaceCamera: ({ onVerified }: { onVerified: (proof: unknown, image: string) => void }) => <button onClick={() => onVerified({session_id:"s",context_hash:"h",expires_at:"2099-01-01T00:00:00Z"},"photo")}>Mock verificar</button> }))
afterEach(cleanup)

describe("explicit facial receipt acceptance", () => {
  it("does not create a delivery when the camera verifies a face", () => {
    const confirm = vi.fn().mockResolvedValue(undefined)
    render(<FacialDeliveryConfirmation employeeId="e" employeeLabel="Ana" items={[{name:"Luva",quantity:2}]} onConfirm={confirm} onManual={() => {}} />)
    fireEvent.click(screen.getByText("Mock verificar"))
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByRole("button", {name:"Confirmar recebimento dos EPIs"})).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", {name:"Confirmar recebimento dos EPIs"}))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({session_id:"s",context_hash:"h",idempotency_key:expect.any(String)}),"photo")
  })

  it("repeats an uncertain request with the same proof/key and does not permit a second signing method", async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error("Conexão interrompida")).mockResolvedValue(undefined)
    const locked = vi.fn()
    render(<FacialDeliveryConfirmation employeeId="e" employeeLabel="Ana" items={[{name:"Luva",quantity:2}]} onConfirm={confirm} onManual={() => {}} onTransactionLocked={locked} />)
    fireEvent.click(screen.getByText("Mock verificar"))
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button",{name:"Confirmar recebimento dos EPIs"}))
    await screen.findByText("Conexão interrompida")
    expect(screen.getByRole("button",{name:"Usar assinatura manual"})).toBeDisabled()
    fireEvent.click(screen.getByRole("button",{name:"Confirmar recebimento dos EPIs"}))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    expect(confirm.mock.calls[1][0]).toEqual(confirm.mock.calls[0][0])
    expect(locked).toHaveBeenCalledWith(true)
  })

  it("requires a new verification if employee/items change", () => {
    const common = {employeeId:"e",employeeLabel:"Ana",onConfirm:vi.fn().mockResolvedValue(undefined),onManual:() => {}}
    const {rerender} = render(<FacialDeliveryConfirmation {...common} items={[{name:"Luva",quantity:1}]} />)
    fireEvent.click(screen.getByText("Mock verificar"))
    expect(screen.getByRole("checkbox")).toBeInTheDocument()
    rerender(<FacialDeliveryConfirmation {...common} items={[{name:"Luva",quantity:2}]} />)
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(screen.getByText("Mock verificar")).toBeInTheDocument()
    expect(common.onConfirm).not.toHaveBeenCalled()
  })
})
