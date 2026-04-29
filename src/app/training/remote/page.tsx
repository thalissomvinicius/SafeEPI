"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import SignatureCanvas from "react-signature-canvas"
import { Camera, CheckCircle2, Fingerprint, Loader2, PenTool, ShieldAlert, X } from "lucide-react"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { formatCpf } from "@/utils/cpf"
import { toast } from "sonner"

type RemoteTrainingData = {
  trainingName?: string
  completionDate?: string
  expiryDate?: string
}

type RemoteEmployee = {
  id: string
  full_name: string
  cpf: string
  photo_url: string | null
  face_descriptor: number[] | null
}

function RemoteTrainingSignatureContent() {
  const searchParams = useSearchParams()
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  const token = searchParams.get("t") || ""

  const [phase, setPhase] = useState<"loading" | "error" | "verify" | "sign" | "done">("loading")
  const [errorMsg, setErrorMsg] = useState("")
  const [employee, setEmployee] = useState<RemoteEmployee | null>(null)
  const [data, setData] = useState<RemoteTrainingData>({})
  const [cpfInput, setCpfInput] = useState("")
  const [authMethod, setAuthMethod] = useState<"manual" | "facial" | "manual_facial">("manual_facial")
  const [capturedPhotoBase64, setCapturedPhotoBase64] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const loadLink = async () => {
      try {
        if (!token) {
          setErrorMsg("Link invalido ou expirado.")
          setPhase("error")
          return
        }

        const res = await fetch(`/api/remote-links?token=${token}`)
        const payload = await res.json()
        if (!res.ok) {
          setErrorMsg(payload.error || "Link invalido.")
          setPhase(payload.status === "completed" ? "done" : "error")
          return
        }

        if (payload.link.type !== "training_signature" && payload.link.data?.remoteType !== "training_signature") {
          setErrorMsg("Este link nao e de assinatura de treinamento.")
          setPhase("error")
          return
        }

        setEmployee(payload.link.employee)
        setData(payload.link.data || {})
        setPhase("verify")
      } catch {
        setErrorMsg("Nao foi possivel carregar o link.")
        setPhase("error")
      }
    }

    void loadLink()
  }, [token])

  const verifyCpf = () => {
    if (!employee) return
    if (cpfInput.replace(/\D/g, "") !== employee.cpf.replace(/\D/g, "")) {
      toast.error("CPF nao confere com o colaborador vinculado.")
      return
    }
    setPhase("sign")
  }

  const saveSignature = async (signatureBase64: string, photoBase64?: string | null) => {
    try {
      setIsSaving(true)
      const res = await fetch("/api/remote-training-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          signatureBase64,
          photoBase64: photoBase64 || null,
          authMethod,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Erro ao salvar assinatura.")
      setPhase("done")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar assinatura.")
    } finally {
      setIsSaving(false)
    }
  }

  if (phase === "loading") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#8B1A1A]" />
      </div>
    )
  }

  if (phase === "error") {
    return (
      <div className="min-h-screen bg-slate-50 p-4 flex items-center justify-center text-center">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 max-w-md shadow-xl">
          <ShieldAlert className="w-14 h-14 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Link indisponivel</h1>
          <p className="text-sm text-slate-500 mt-2">{errorMsg}</p>
        </div>
      </div>
    )
  }

  if (phase === "done") {
    return (
      <div className="min-h-screen bg-slate-50 p-4 flex items-center justify-center text-center">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 max-w-md shadow-xl">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Assinatura registrada</h1>
          <p className="text-sm text-slate-500 mt-2">Este link foi concluido e nao pode ser usado novamente.</p>
        </div>
      </div>
    )
  }

  if (phase === "verify") {
    return (
      <div className="min-h-screen bg-slate-50 p-4 flex items-center justify-center">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full shadow-xl space-y-5">
          <div className="text-center">
            <h1 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Assinatura de Treinamento</h1>
            <p className="text-xs text-slate-500 mt-1">{data.trainingName || "Treinamento"}</p>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Colaborador</p>
            <p className="font-black text-slate-800 uppercase text-sm mt-1">{employee?.full_name}</p>
          </div>
          <input
            value={cpfInput}
            onChange={(e) => setCpfInput(formatCpf(e.target.value))}
            placeholder="000.000.000-00"
            maxLength={14}
            inputMode="numeric"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-center font-black tracking-widest outline-none focus:border-[#8B1A1A]"
          />
          <button
            onClick={verifyCpf}
            disabled={cpfInput.replace(/\D/g, "").length < 11}
            className="w-full py-4 rounded-xl bg-[#8B1A1A] text-white font-black uppercase tracking-widest text-xs disabled:opacity-40"
          >
            Verificar CPF
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 flex items-center justify-center">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full shadow-xl space-y-5">
        <div className="text-center">
          <h1 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Assine o treinamento</h1>
          <p className="text-xs text-slate-500 mt-1">{employee?.full_name}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl">
          <button onClick={() => setAuthMethod("manual")} className={`py-3 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 ${authMethod === "manual" ? "bg-white text-slate-800 shadow" : "text-slate-400"}`}>
            <PenTool className="w-4 h-4" /> Manual
          </button>
          <button onClick={() => { setAuthMethod("manual_facial"); setCapturedPhotoBase64(null); }} className={`py-3 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 ${authMethod === "manual_facial" ? "bg-white text-emerald-700 shadow" : "text-slate-400"}`}>
            <Camera className="w-4 h-4" /> Foto + Assin.
          </button>
          <button onClick={() => setAuthMethod("facial")} className={`py-3 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 ${authMethod === "facial" ? "bg-white text-blue-700 shadow" : "text-slate-400"}`}>
            <Fingerprint className="w-4 h-4" /> Facial
          </button>
        </div>

        {(authMethod === "manual" || authMethod === "manual_facial") ? (
          <div className="space-y-3">
            {authMethod === "manual_facial" && !capturedPhotoBase64 && employee?.face_descriptor && (
              <FaceCamera
                targetDescriptor={new Float32Array(employee.face_descriptor)}
                onCapture={(_, img) => setCapturedPhotoBase64(img)}
                onCancel={() => setAuthMethod("manual")}
              />
            )}
            {authMethod === "manual_facial" && capturedPhotoBase64 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={capturedPhotoBase64} alt="Foto capturada" className="w-12 h-12 rounded-xl object-cover border border-emerald-200" />
                <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest leading-relaxed">Foto confirmada. Agora assine abaixo para concluir.</p>
              </div>
            )}
            {authMethod === "manual_facial" && !employee?.face_descriptor && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center text-xs font-bold text-amber-800">
                Biometria facial nao cadastrada. Use assinatura manual.
              </div>
            )}
            <div className="border-2 border-dashed border-slate-200 rounded-xl overflow-hidden bg-slate-50 h-48">
              <SignatureCanvas ref={sigCanvas} canvasProps={{ className: "w-full h-full touch-none" }} penColor="#1e293b" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => sigCanvas.current?.clear()} className="px-5 py-3 rounded-xl border border-slate-200 text-slate-500 font-black uppercase tracking-widest text-[10px]">
                <X className="w-4 h-4 inline mr-1" /> Limpar
              </button>
              <button
                disabled={isSaving}
                onClick={() => {
                  if (sigCanvas.current?.isEmpty()) {
                    toast.error("Assine antes de confirmar.")
                    return
                  }
                  if (authMethod === "manual_facial" && employee?.face_descriptor && !capturedPhotoBase64) {
                    toast.error("Capture a foto antes de confirmar.")
                    return
                  }
                  void saveSignature(sigCanvas.current!.toDataURL("image/png"), capturedPhotoBase64)
                }}
                className="flex-1 py-3 rounded-xl bg-[#8B1A1A] text-white font-black uppercase tracking-widest text-[10px] disabled:opacity-50"
              >
                {isSaving ? "Salvando..." : "Confirmar assinatura"}
              </button>
            </div>
          </div>
        ) : employee?.face_descriptor ? (
          <FaceCamera
            targetDescriptor={new Float32Array(employee.face_descriptor)}
            onCapture={(_, img) => void saveSignature(img, img)}
            onCancel={() => setAuthMethod("manual")}
          />
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center">
            <Camera className="w-8 h-8 text-amber-600 mx-auto mb-2" />
            <p className="text-sm font-bold text-amber-800">Biometria facial nao cadastrada. Use assinatura manual.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function RemoteTrainingSignaturePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#8B1A1A]" /></div>}>
      <RemoteTrainingSignatureContent />
    </Suspense>
  )
}
