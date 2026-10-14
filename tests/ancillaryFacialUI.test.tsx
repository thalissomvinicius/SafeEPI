import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import RemoteTrainingSignaturePage from "@/app/training/remote/page"

const photo = "data:image/jpeg;base64,cGhvdG8="
const signature = "data:image/png;base64,c2lnbmF0dXJl"
const mocks = vi.hoisted(() => ({ error: vi.fn(), cameraMode: vi.fn() }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams({ t: "training-token" }) }))
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.error } }))
vi.mock("@/components/ui/FaceCamera", () => ({
  FaceCamera: ({ mode, onCapture }: { mode: string; onCapture: (descriptor: number[], image: string) => void }) => {
    mocks.cameraMode(mode)
    return <button onClick={() => onCapture([], "data:image/jpeg;base64,cGhvdG8=")}>Capturar apoio de teste</button>
  },
}))
vi.mock("@/components/ui/SignatureCapture", () => ({
  SignatureCapture: ({ signatureRef, onConfirm }: { signatureRef: { current: unknown }; onConfirm: () => void }) => {
    signatureRef.current = { isEmpty: () => false, toDataURL: () => "data:image/png;base64,c2lnbmF0dXJl" }
    return <button onClick={onConfirm}>Confirmar assinatura</button>
  },
}))

async function openSignature() {
  render(<RemoteTrainingSignaturePage />)
  fireEvent.change(await screen.findByPlaceholderText("000.000.000-00"), { target: { value: "529.982.247-25" } })
  fireEvent.click(screen.getByRole("button", { name: "Verificar CPF" }))
}

describe("Treinamento: foto de apoio não é autenticação facial", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_input: string, init?: RequestInit) => ({
      ok: true,
      json: async () => init?.method === "POST" ? { success: true } : {
        link: { type: "training_signature", status: "pending", data: { trainingName: "NR-06" }, employee: { id: "employee-1", full_name: "ANA SILVA", cpf: "529.982.247-25", photo_url: null } },
      },
    })))
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it("oferece foto de evidência sem cadastro biométrico e não oferece assinatura facial isolada", async () => {
    await openSignature()
    expect(screen.queryByRole("button", { name: "Facial" })).not.toBeInTheDocument()
    expect(screen.queryByText(/biometria facial nao cadastrada/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Capturar foto de apoio" }))
    expect(mocks.cameraMode).toHaveBeenCalledWith("evidence")
    expect(screen.getByRole("button", { name: "Capturar apoio de teste" })).toBeInTheDocument()
  })

  it("bloqueia foto + assinatura sem foto, mesmo sem foto no cadastro", async () => {
    await openSignature()
    fireEvent.click(screen.getByRole("button", { name: "Confirmar assinatura" }))
    expect(mocks.error).toHaveBeenCalledWith("Capture a foto antes de confirmar.")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("envia imagem de apoio separada da assinatura manual sem alegar facial", async () => {
    await openSignature()
    fireEvent.click(screen.getByRole("button", { name: "Capturar foto de apoio" }))
    fireEvent.click(screen.getByRole("button", { name: "Capturar apoio de teste" }))
    fireEvent.click(screen.getByRole("button", { name: "Confirmar assinatura" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/remote-training-signature", expect.objectContaining({
      method: "POST", body: JSON.stringify({ token: "training-token", signatureBase64: signature, photoBase64: photo, authMethod: "manual_facial" }),
    })))
    expect(await screen.findByRole("heading", { name: "Assinatura registrada" })).toBeInTheDocument()
  })
})
