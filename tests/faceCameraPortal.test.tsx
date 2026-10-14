import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { FaceCamera } from "@/components/ui/FaceCamera"

vi.mock("@/services/api", () => ({ api: { getAuthHeaders: vi.fn().mockResolvedValue({}) } }))
const stop = vi.fn()
const getUserMedia = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, "mediaDevices", {configurable:true,value:{getUserMedia}})
  getUserMedia.mockResolvedValue({getTracks: () => [{stop}]})
  vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("isolated mobile camera", () => {
  it("keeps supervised controls outside the video column in compact landscape", async () => {
    render(<FaceCamera mode="enroll" employeeId="employee" onCapture={vi.fn()} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole("button",{name:"Abrir câmera em tela inteira"}))
    const dialog = await screen.findByRole("dialog")
    const controls = screen.getByTestId("face-camera-controls")
    const video = dialog.querySelector("video")!
    expect(controls).toContainElement(screen.getByRole("checkbox"))
    expect(controls).not.toContainElement(video)
    expect(controls.className).toContain("(orientation:landscape)]:overflow-y-auto")
    expect(video.parentElement?.className).toContain("(orientation:landscape)]:min-h-0")
    expect(screen.getByTestId("face-camera-layout").className).toContain("(orientation:landscape)]:grid")
  })

  it("locks the scrolling root and restores the previous root/body overflow after unmount", async () => {
    const root = document.documentElement
    const originalRootStyle = root.style.cssText
    const originalBodyStyle = document.body.style.cssText
    try {
      root.style.overflowX = "hidden"
      root.style.overflowY = "scroll"
      document.body.style.overflow = "clip"
      const {unmount} = render(<FaceCamera mode="evidence" onCapture={vi.fn()} onCancel={() => {}} />)
      fireEvent.click(screen.getByRole("button",{name:"Abrir câmera em tela inteira"}))
      await screen.findByRole("dialog")
      expect(root.style.overflow).toBe("hidden")
      expect(document.body.style.overflow).toBe("hidden")
      unmount()
      expect(root.style.overflowX).toBe("hidden")
      expect(root.style.overflowY).toBe("scroll")
      expect(document.body.style.overflow).toBe("clip")
    } finally {
      cleanup()
      root.style.cssText = originalRootStyle
      document.body.style.cssText = originalBodyStyle
    }
  })

  it("opens outside its parent, stops the previous camera when switching and cleans up on exit", async () => {
    const cancel = vi.fn()
    const {container} = render(<div><FaceCamera mode="evidence" onCapture={vi.fn()} onCancel={cancel}/></div>)
    fireEvent.click(screen.getByRole("button",{name:"Abrir câmera em tela inteira"}))
    const dialog = await screen.findByRole("dialog")
    expect(container.contains(dialog)).toBe(false)
    expect(container.inert).toBe(true)
    expect(document.body.style.overflow).toBe("hidden")
    expect(document.documentElement.style.overflow).toBe("hidden")
    expect(dialog.querySelector("video")).toHaveAttribute("playsinline")
    expect(dialog.querySelector("video")).toHaveClass("object-contain")
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button",{name:"Trocar câmera"}))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    expect(stop).toHaveBeenCalled()
    expect(getUserMedia.mock.calls[1][0].video.facingMode.ideal).toBe("environment")
    fireEvent.click(screen.getByRole("button",{name:"Fechar câmera"}))
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe("")
    expect(document.documentElement.style.overflow).toBe("")
  })

  it("Escape closes only the camera, not a containing modal", async () => {
    const parentClose = vi.fn()
    document.addEventListener("keydown", parentClose)
    const cancel = vi.fn()
    render(<FaceCamera mode="evidence" onCapture={vi.fn()} onCancel={cancel}/>)
    fireEvent.click(screen.getByRole("button",{name:"Abrir câmera em tela inteira"}))
    await screen.findByRole("dialog")
    fireEvent.keyDown(document,{key:"Escape"})
    expect(cancel).toHaveBeenCalledOnce()
    expect(parentClose).not.toHaveBeenCalled()
    document.removeEventListener("keydown",parentClose)
  })

  it("does not mark a blocked camera as an accepted photo or biometric", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied","NotAllowedError"))
    const capture = vi.fn(), verified = vi.fn()
    render(<FaceCamera mode="verify" verifyEmployeeId="e" onCapture={capture} onVerified={verified} onCancel={() => {}}/>)
    fireEvent.click(screen.getByRole("button",{name:"Abrir câmera em tela inteira"}))
    expect(await screen.findByRole("alert")).toHaveTextContent("permissão")
    expect(capture).not.toHaveBeenCalled()
    expect(verified).not.toHaveBeenCalled()
  })

  it("does not fall back to a false facial approval when the server cannot perform PAD", async () => {
    const capture = vi.fn(), verified = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype,"toBlob").mockImplementation(callback => callback(new Blob(["fake test frame"],{type:"image/jpeg"})))
    const request = vi.fn()
      .mockResolvedValueOnce({ok:true,json:async () => ({session_id:"s",context_hash:"h",expires_at:"2099-01-01T00:00:00Z"})})
      .mockResolvedValueOnce({ok:true,json:async () => ({decision:"unavailable",reason:"pad_not_configured"})})
    vi.stubGlobal("fetch",request)
    render(<FaceCamera mode="verify" verifyEmployeeId="e" verifyToken="link" onCapture={capture} onVerified={verified} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole("button",{name:"Abrir câmera em tela inteira"}))
    const video = (await screen.findByRole("dialog")).querySelector("video")!
    Object.defineProperties(video,{videoWidth:{value:640},videoHeight:{value:480}})
    fireEvent.canPlay(video)
    fireEvent.click(screen.getByRole("button",{name:"Capturar e verificar"}))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("NÃO foi verificada"))
    expect(request).toHaveBeenCalledTimes(2)
    expect(capture).not.toHaveBeenCalled()
    expect(verified).not.toHaveBeenCalled()
  })
})
