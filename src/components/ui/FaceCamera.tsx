"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Camera, Loader2, SwitchCamera, X } from "lucide-react"
import { api } from "@/services/api"
import { cameraErrorMessage, normalizeFacialDecision, type FacialContext, type FacialEnrollment, type FacialProof } from "./facialClient"

interface FaceCameraProps {
  /** Compatibility only: no client descriptors are produced or accepted. */
  onCapture: (descriptor: number[], imageBase64: string) => void
  employeeId?: string
  verifyEmployeeId?: string
  verifyCompanyId?: string | null
  verifyToken?: string | null
  requireLiveness?: boolean
  mode?: "enroll" | "verify" | "evidence"
  context?: FacialContext
  onEnrolled?: (enrollment: FacialEnrollment, imageBase64: string) => void
  onVerified?: (proof: FacialProof, imageBase64: string) => void
  employeeLabel?: string
  onCancel: () => void
  cancelLabel?: string
}

function toDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("Não foi possível ler a foto."))
    reader.readAsDataURL(blob)
  })
}

export function FaceCamera({ onCapture, employeeId, verifyEmployeeId, verifyToken, mode: requestedMode, context, onEnrolled, onVerified, employeeLabel, onCancel, cancelLabel = "Voltar" }: FaceCameraProps) {
  const mode = requestedMode ?? (verifyEmployeeId ? "verify" : "enroll")
  const targetEmployee = verifyEmployeeId || employeeId
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [facing, setFacing] = useState<"user" | "environment">("user")
  const [supervised, setSupervised] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [portal, setPortal] = useState<HTMLElement | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const captureGeneration = useRef(0)
  const headingId = useId()
  const descriptionId = useId()
  const title = mode === "enroll" ? "Cadastrar rosto" : mode === "verify" ? "Verificar identidade" : "Registrar foto de evidência"

  function openCamera() {
    const host = document.createElement("div")
    host.dataset.facialCamera = "true"
    document.body.appendChild(host)
    setPortal(host)
    setReady(false)
    setError("")
    setSupervised(false)
    setOpen(true)
  }

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const close = useCallback(() => {
    captureGeneration.current += 1
    busyRef.current = false
    setBusy(false)
    requestRef.current?.abort()
    stopCamera()
    setOpen(false)
    onCancel()
  }, [onCancel, stopCamera])

  useEffect(() => {
    if (!open || !portal) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const host = portal
    const siblings = Array.from(document.body.children).filter(node => node !== host && node instanceof HTMLElement) as HTMLElement[]
    const previousInert = siblings.map(node => node.inert)
    siblings.forEach(node => { node.inert = true })
    // Lock both possible scrolling roots. html overflow-x:hidden can otherwise
    // imply overflow-y:auto and leave a scrollbar beside a fullscreen portal.
    const overflowProperties = ["overflow", "overflow-x", "overflow-y"]
    const scrollLocks = [document.body, document.documentElement].map(element => {
      const declarations = Array.from(element.style)
        .filter(property => overflowProperties.includes(property))
        .map(property => ({ property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) }))
      element.style.setProperty("overflow", "hidden")
      return { element, declarations }
    })
    return () => {
      captureGeneration.current += 1
      requestRef.current?.abort()
      stopCamera()
      siblings.forEach((node, index) => { node.inert = previousInert[index] })
      scrollLocks.forEach(({element, declarations}) => {
        overflowProperties.forEach(property => element.style.removeProperty(property))
        declarations.forEach(({property, value, priority}) => element.style.setProperty(property, value, priority))
      })
      host.remove()
      previousFocus?.focus()
    }
  }, [open, portal, stopCamera])

  useEffect(() => {
    if (!open || !portal || !portal.isConnected) return
    dialogRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); event.preventDefault(); close(); return }
      if (event.key !== "Tab") return
      // This portal is the active dialog; parent modal shortcuts must not run.
      event.stopImmediatePropagation()
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')
      if (!focusable?.length) { event.preventDefault(); return }
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener("keydown", keydown, true)
    return () => document.removeEventListener("keydown", keydown, true)
  }, [open, portal, close])

  useEffect(() => {
    if (!open || !portal || !portal.isConnected) return
    let disposed = false
    stopCamera()
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Câmera indisponível. Abra o link em HTTPS no Safari, Chrome ou Edge atualizado.")
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } } })
        if (disposed) { stream.getTracks().forEach(track => track.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) { stopCamera(); return }
        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play()
      } catch (cause) { if (!disposed) { stopCamera(); setError(cameraErrorMessage(cause)) } }
    }
    void start()
    const suspend = () => { if (document.visibilityState === "hidden") { stopCamera(); setReady(false); setError("A câmera foi pausada. Toque em tentar novamente ao voltar.") } }
    document.addEventListener("visibilitychange", suspend)
    return () => { disposed = true; stopCamera(); document.removeEventListener("visibilitychange", suspend) }
  }, [open, portal, facing, attempt, stopCamera])

  async function post<T>(url: string, form: FormData): Promise<T> {
    const controller = new AbortController()
    requestRef.current = controller
    const timer = window.setTimeout(() => controller.abort(), 25000)
    try {
      const headers = verifyToken ? {} : await api.getAuthHeaders()
      if (verifyToken) form.set("token", verifyToken)
      const response = await fetch(url, { method: "POST", headers, body: form, signal: controller.signal })
      const result = await response.json().catch(() => null)
      if (!response.ok) throw new Error(result?.error || result?.message || "Verificação indisponível. Tente novamente ou use assinatura manual.")
      return result as T
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") throw new Error("A operação não foi confirmada. Verifique a conexão e tente novamente. Nenhuma entrega foi concluída.")
      throw cause
    } finally { window.clearTimeout(timer); requestRef.current = null }
  }

  async function capture() {
    if (busyRef.current) return
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) { setError("Aguarde a imagem da câmera antes de capturar."); return }
    if (mode !== "evidence" && !targetEmployee) { setError("Salve e selecione o colaborador antes de cadastrar o rosto."); return }
    if (mode === "enroll" && !verifyToken && !supervised) { setError("Confirme presencialmente a identidade do colaborador antes do cadastro."); return }
    busyRef.current = true
    const generation = ++captureGeneration.current
    setBusy(true)
    setError("")
    try {
      const canvas = document.createElement("canvas")
      const scale = Math.min(1, 1280 / video.videoWidth)
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      const drawing = canvas.getContext("2d")
      if (!drawing) throw new Error("Captura indisponível neste navegador.")
      // Full, unmirrored preview is exactly the image submitted to the server.
      drawing.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Falha ao capturar a foto.")), "image/jpeg", 0.88))
      const image = await toDataUrl(blob)
      if (generation !== captureGeneration.current) return
      if (mode === "evidence") { stopCamera(); setOpen(false); onCapture([], image); return }
      const form = new FormData()
      form.set("employee_id", targetEmployee!)
      if (mode === "enroll") {
        form.set("frame", blob, "cadastro.jpg")
        if (!verifyToken) form.set("supervised_confirmation", "true")
        const enrollment = await post<FacialEnrollment>("/api/facial/enroll", form)
        if (generation !== captureGeneration.current) return
        if (!enrollment.enrollment_id || !["approved", "pending"].includes(enrollment.status)) throw new Error("O servidor não confirmou o cadastro. Tente novamente.")
        stopCamera(); setOpen(false)
        onEnrolled?.(enrollment, image)
        onCapture([], image)
        return
      }
      if (!verifyToken && !context) throw new Error("Selecione os itens da entrega antes de verificar o rosto.")
      if (context) form.set("context", JSON.stringify(context))
      const session = await post<FacialProof>("/api/facial/session", form)
      if (generation !== captureGeneration.current) return
      const frame = new FormData()
      frame.set("session_id", session.session_id)
      frame.set("frame", blob, "verificacao.jpg")
      const result = await post<FacialProof & { decision: string; reason?: string }>("/api/facial/verify", frame)
      if (generation !== captureGeneration.current) return
      const decision = normalizeFacialDecision(result)
      if (decision !== "approved") throw new Error(decision === "rejected"
        ? "O rosto não foi aprovado. Confira o colaborador selecionado, a iluminação e tente novamente ou use assinatura manual."
        : "A verificação facial segura está indisponível. A identidade NÃO foi verificada. Use assinatura manual para continuar.")
      if (!onVerified) throw new Error("Esta tela não suporta confirmação facial de entrega. Use assinatura manual.")
      stopCamera(); setOpen(false)
      onVerified(result, image)
    } catch (cause) { setError(cameraErrorMessage(cause)) }
    finally { if (generation === captureGeneration.current) { busyRef.current = false; setBusy(false) } }
  }

  return <>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
      <Camera className="mx-auto mb-3 h-8 w-8 text-blue-700" aria-hidden="true" />
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      {employeeLabel && <p className="mt-1 text-sm font-semibold">{employeeLabel}</p>}
      <p className="my-3 text-sm text-slate-600">{mode === "evidence" ? "Foto complementar à assinatura manual. Não é reconhecimento biométrico." : "Use boa iluminação, deixe apenas um rosto visível e retire acessórios que cubram o rosto."}</p>
      {mode === "enroll" && !targetEmployee && <p role="status" className="mb-3 text-sm text-amber-800">Salve o cadastro do colaborador primeiro. Depois, abra a edição para cadastrar o rosto.</p>}
      <button type="button" disabled={mode !== "evidence" && !targetEmployee} onClick={openCamera} className="min-h-12 w-full rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-50">Abrir câmera em tela inteira</button>
      <button type="button" onClick={onCancel} className="mt-2 min-h-11 w-full rounded-xl px-4 py-2 text-sm font-semibold text-slate-600">{cancelLabel}</button>
    </section>
    {open && portal && createPortal(<div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId} className="fixed inset-0 z-[10000] flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-slate-950 text-white outline-none">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/15 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] [@media(max-height:499px)_and_(orientation:landscape)]:pb-2 [@media(max-height:499px)_and_(orientation:landscape)]:pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="min-w-0"><h2 id={headingId} className="text-base font-bold sm:text-xl">{title}</h2>{employeeLabel && <p className="truncate text-sm text-slate-300">{employeeLabel}</p>}</div>
        <button type="button" onClick={close} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white/10" aria-label="Fechar câmera"><X aria-hidden="true" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 [@media(max-height:499px)_and_(orientation:landscape)]:overflow-hidden [@media(max-height:499px)_and_(orientation:landscape)]:p-3">
        <div data-testid="face-camera-layout" className="mx-auto flex w-full max-w-3xl flex-col gap-3 [@media(max-height:499px)_and_(orientation:landscape)]:grid [@media(max-height:499px)_and_(orientation:landscape)]:h-full [@media(max-height:499px)_and_(orientation:landscape)]:min-h-0 [@media(max-height:499px)_and_(orientation:landscape)]:max-w-5xl [@media(max-height:499px)_and_(orientation:landscape)]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] [@media(max-height:499px)_and_(orientation:landscape)]:grid-rows-[auto_minmax(0,1fr)] [@media(max-height:499px)_and_(orientation:landscape)]:gap-2">
          <p id={descriptionId} className="text-center text-sm text-slate-200 [@media(max-height:499px)_and_(orientation:landscape)]:col-start-2 [@media(max-height:499px)_and_(orientation:landscape)]:row-start-1 [@media(max-height:499px)_and_(orientation:landscape)]:text-left [@media(max-height:499px)_and_(orientation:landscape)]:text-xs">Olhe para a câmera e mantenha o rosto inteiro visível. A imagem enviada será a mesma exibida na prévia.</p>
          <div className="relative flex h-[45dvh] min-h-[180px] max-h-[520px] items-center justify-center overflow-hidden rounded-2xl bg-black [@media(max-height:499px)_and_(orientation:landscape)]:col-start-1 [@media(max-height:499px)_and_(orientation:landscape)]:row-span-2 [@media(max-height:499px)_and_(orientation:landscape)]:row-start-1 [@media(max-height:499px)_and_(orientation:landscape)]:h-full [@media(max-height:499px)_and_(orientation:landscape)]:min-h-0 [@media(max-height:499px)_and_(orientation:landscape)]:max-h-none">
            <video ref={videoRef} autoPlay playsInline muted onLoadedData={() => setReady(true)} onCanPlay={() => setReady(true)} className="h-full w-full object-contain" aria-label="Prévia da câmera" />
            {!ready && !error && <span className="absolute flex items-center gap-2 rounded-xl bg-black/80 p-3"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Aguardando câmera…</span>}
          </div>
          <div data-testid="face-camera-controls" className="flex min-w-0 flex-col gap-3 [@media(max-height:499px)_and_(orientation:landscape)]:col-start-2 [@media(max-height:499px)_and_(orientation:landscape)]:row-start-2 [@media(max-height:499px)_and_(orientation:landscape)]:min-h-0 [@media(max-height:499px)_and_(orientation:landscape)]:overflow-y-auto [@media(max-height:499px)_and_(orientation:landscape)]:overscroll-contain [@media(max-height:499px)_and_(orientation:landscape)]:gap-2">
            {error && <p role="alert" className="rounded-xl border border-amber-300/40 bg-amber-950 p-3 text-sm text-amber-100">{error}</p>}
            {mode === "enroll" && !verifyToken && <label className="flex min-h-12 shrink-0 items-start gap-3 rounded-xl bg-white/10 p-3 text-sm [@media(max-height:499px)_and_(orientation:landscape)]:p-2 [@media(max-height:499px)_and_(orientation:landscape)]:text-xs"><input type="checkbox" checked={supervised} onChange={event => setSupervised(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />Conferi presencialmente a identidade e confirmo que este rosto pertence ao colaborador selecionado.</label>}
            {mode === "enroll" && verifyToken && <p className="rounded-xl bg-white/10 p-3 text-sm">O cadastro enviado por link ficará pendente de conferência e aprovação do responsável.</p>}
            {mode === "evidence" && <p className="text-sm text-amber-100">Esta foto é apenas evidência visual e não comprova identidade nem prova de vida.</p>}
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => {setReady(false); setError(""); setFacing(value => value === "user" ? "environment" : "user")}} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm disabled:opacity-50"><SwitchCamera className="h-5 w-5" aria-hidden="true" />Trocar câmera</button>
              {error && <button type="button" disabled={busy} onClick={() => {setReady(false); setError(""); setAttempt(value => value + 1)}} className="min-h-11 flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm">Tentar novamente</button>}
            </div>
          </div>
        </div>
      </div>
      <footer className="shrink-0 border-t border-white/15 bg-slate-950 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] [@media(max-height:499px)_and_(orientation:landscape)]:pt-2 [@media(max-height:499px)_and_(orientation:landscape)]:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 [@media(max-height:499px)_and_(orientation:landscape)]:max-w-5xl [@media(max-height:499px)_and_(orientation:landscape)]:flex-row">
          <button type="button" onClick={() => void capture()} disabled={!ready || busy || (mode === "enroll" && !verifyToken && !supervised)} className="min-h-12 rounded-xl bg-blue-600 px-4 py-3 font-bold disabled:opacity-50 [@media(max-height:499px)_and_(orientation:landscape)]:min-h-11 [@media(max-height:499px)_and_(orientation:landscape)]:flex-1 [@media(max-height:499px)_and_(orientation:landscape)]:py-2">{busy ? "Aguardando resposta do servidor…" : mode === "verify" ? "Capturar e verificar" : mode === "enroll" ? "Enviar cadastro facial" : "Capturar foto"}</button>
          <button type="button" onClick={close} className="min-h-11 rounded-xl px-3 py-2 text-sm text-slate-200 [@media(max-height:499px)_and_(orientation:landscape)]:min-w-[140px]">{mode === "verify" ? "Usar assinatura manual" : cancelLabel}</button>
        </div>
      </footer>
    </div>, portal)}
  </>
}
