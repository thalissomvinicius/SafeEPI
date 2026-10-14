"use client"

import { Suspense, useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { AlertTriangle, Camera, CheckCircle2, Hourglass, ShieldCheck } from "lucide-react"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { LoadingState } from "@/components/ui/LoadingState"

type CaptureEmployee = { id: string; full_name: string; registration_number?: string | null }

function CaptureContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const employeeId = params.id as string
  const token = searchParams.get("t")
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [employee, setEmployee] = useState<CaptureEmployee | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    async function validateLink() {
      setLoading(true)
      setEmployee(null)
      setPageError(null)
      setIsCapturing(false)
      setSubmitted(false)
      try {
        if (!employeeId || !token) {
          throw new Error("Solicite um novo link de cadastro ao responsável da empresa. Este endereço não contém uma autorização válida.")
        }
        const res = await fetch(`/api/remote-links?${new URLSearchParams({ token })}`, {
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await res.json()
        if (!current) return
        if (!res.ok) {
          if (data.status === "completed") {
            throw new Error("Este link já foi utilizado. Consulte o responsável da empresa para saber se o cadastro foi aprovado; uma foto enviada não significa biometria ativa.")
          }
          throw new Error(data.error || "Não foi possível validar o link. Solicite um novo link de cadastro.")
        }
        const link = data.link
        if (link?.type !== "capture" || link.employee_id !== employeeId || link.employee?.id !== employeeId || link.status !== "pending") {
          throw new Error("Este link não corresponde a este cadastro ou não está disponível para captura.")
        }
        setEmployee({ id: link.employee.id, full_name: link.employee.full_name, registration_number: link.employee.registration_number })
      } catch (error) {
        if (current) {
          setPageError(controller.signal.aborted ? "A consulta demorou demais. Reabra o link para tentar novamente." : error instanceof Error ? error.message : "Falha ao abrir o cadastro. Tente novamente.")
        }
      } finally {
        window.clearTimeout(timeout)
        if (current) setLoading(false)
      }
    }
    void validateLink()
    return () => { current = false; window.clearTimeout(timeout); controller.abort() }
  }, [employeeId, token])

  const pageClass = "flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-4 py-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"

  if (loading) return <div className={pageClass}><LoadingState variant="page" label="Abrindo cadastro facial" detail="Validando a autorização de captura." /></div>

  if (pageError || !employee) {
    return (
      <main className={pageClass}>
        <div className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-12 w-12 text-amber-600" aria-hidden="true" />
          <h1 className="text-xl font-bold text-slate-900">Cadastro indisponível</h1>
          <p role="alert" className="text-sm leading-relaxed text-slate-600">{pageError || "Solicite um novo link de cadastro."}</p>
        </div>
      </main>
    )
  }

  if (submitted) {
    return (
      <main className={pageClass}>
        <div className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 text-center shadow-sm" role="status">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" aria-hidden="true" />
          <h1 className="text-xl font-bold text-slate-900">Cadastro enviado para revisão</h1>
          <p className="text-sm leading-relaxed text-slate-600">O reconhecimento facial ainda não está liberado. Um responsável autorizado precisa conferir sua identidade e aprovar este cadastro.</p>
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Você pode fechar esta tela. O link de captura é de uso único.</p>
        </div>
      </main>
    )
  }

  return (
    <main className={pageClass}>
      <div className="w-full max-w-md space-y-5 rounded-3xl bg-white p-6 shadow-sm">
        <Camera className="h-10 w-10 text-blue-600" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cadastro facial</h1>
          <p className="mt-1 text-sm font-semibold text-slate-700">{employee.full_name}</p>
          {employee.registration_number && <p className="mt-1 text-sm text-slate-600">Matrícula: {employee.registration_number}</p>}
        </div>
        <p className="text-sm leading-relaxed text-slate-600">Cadastre somente o seu próprio rosto. A captura será analisada no servidor e ficará aguardando a conferência do responsável da empresa.</p>
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Hourglass className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>Este cadastro não confirma recebimento de EPIs nem é uma assinatura. Se os dados acima não forem seus, não prossiga.</p>
        </div>
        <button type="button" onClick={() => setIsCapturing(true)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700">
          <Camera className="h-5 w-5" aria-hidden="true" /> Iniciar câmera
        </button>
        <p className="flex gap-2 text-xs leading-relaxed text-slate-500"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />Use um ambiente iluminado. Se não puder usar a câmera, procure o responsável para uma alternativa de atendimento.</p>
      </div>
      {isCapturing && (
        <FaceCamera
          mode="enroll"
          employeeId={employee.id}
          employeeLabel={employee.registration_number ? `${employee.full_name} · Matrícula ${employee.registration_number}` : employee.full_name}
          verifyToken={token || undefined}
          onCapture={() => { /* Enrollment is confirmed only by the server response below. */ }}
          onEnrolled={(result) => {
            setIsCapturing(false)
            if (result.status !== "pending" || !result.enrollment_id) {
              setPageError("O servidor não confirmou o envio para revisão. Consulte o responsável antes de tentar novamente.")
              return
            }
            setSubmitted(true)
          }}
          onCancel={() => setIsCapturing(false)}
          cancelLabel="Voltar ao cadastro"
        />
      )}
    </main>
  )
}

export default function RemoteCapturePage() {
  return <Suspense fallback={<LoadingState variant="page" label="Abrindo cadastro facial" detail="Preparando a tela segura." />}><CaptureContent /></Suspense>
}
