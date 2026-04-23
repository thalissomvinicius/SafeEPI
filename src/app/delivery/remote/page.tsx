"use client"

import { useState, useRef, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import SignatureCanvas from "react-signature-canvas"
import { CheckCircle2, FileDown, Loader2, ShieldAlert, Fingerprint, PenLine, ShieldCheck } from "lucide-react"
import { api } from "@/services/api"
import { Employee, PPE, Workplace } from "@/types/database"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { generateDeliveryPDF } from "@/utils/pdfGenerator"
import { COMPANY_CONFIG } from "@/config/company"

function RemoteDeliveryContent() {
  const searchParams = useSearchParams()
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  
  const [isSaved, setIsSaved] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [ipAddress, setIpAddress] = useState<string>("")
  const [location, setLocation] = useState<string>("")

  const [data, setData] = useState<any>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [ppe, setPpe] = useState<PPE | null>(null)
  const [workplace, setWorkplace] = useState<Workplace | null>(null)
  const [loading, setLoading] = useState(true)

  const [authMethod, setAuthMethod] = useState<'manual' | 'facial'>('manual')

  useEffect(() => {
    const s = searchParams.get('s')
    if (!s) {
        setError("Link inválido ou expirado.")
        setLoading(false)
        return
    }

    const captureMetadata = async () => {
        try {
            const ipRes = await fetch('https://api.ipify.org?format=json')
            const ipData = await ipRes.json()
            setIpAddress(ipData.ip)
            if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition((pos) => {
                    setLocation(`${pos.coords.latitude}, ${pos.coords.longitude}`)
                })
            }
        } catch (e) {}
    }
    captureMetadata()

    try {
        const decoded = JSON.parse(atob(s))
        setData(decoded)
        
        async function loadDetails() {
            try {
                const [employees, ppes, workplaces] = await Promise.all([
                    api.getEmployees(),
                    api.getPpes(),
                    api.getWorkplaces()
                ])
                const emp = employees.find(e => e.id === decoded.e)
                const p = ppes.find(p => p.id === decoded.p)
                const w = workplaces.find(w => w.id === decoded.w)

                if (!emp || !p) {
                    setError("Dados da entrega não encontrados.")
                } else {
                    setEmployee(emp)
                    setPpe(p)
                    setWorkplace(w || null)
                    if (emp.face_descriptor) setAuthMethod('facial')
                }
            } catch (e) {
                setError("Falha ao conectar com o servidor.")
            } finally {
                setLoading(false)
            }
        }
        loadDetails()
    } catch (e) {
        setError("Erro ao processar o link de assinatura.")
        setLoading(false)
    }
  }, [searchParams])

  const saveDelivery = async (signatureDataUrl: string) => {
    try {
      setIsSaving(true)
      const validationHash = btoa(`${employee?.id}-${ppe?.id}-${Date.now()}`).substring(0, 12).toUpperCase()
      
      const response = await fetch(signatureDataUrl)
      const blob = await response.blob()
      const signatureFile = new File([blob], "remote_signature.png", { type: "image/png" })

      await api.saveDelivery({
        employee_id: employee!.id,
        ppe_id: ppe!.id,
        workplace_id: workplace?.id || null,
        reason: data.r || 'Primeira Entrega',
        quantity: data.q || 1,
        ip_address: ipAddress || "Remoto",
        signature_url: null
      }, signatureFile)

      const pdfBlob = await generateDeliveryPDF({
        employeeName: employee?.full_name || "",
        employeeCpf: employee?.cpf || "",
        employeeRole: employee?.job_title || "",
        workplaceName: workplace?.name || "Sede",
        ppeName: ppe?.name || "",
        ppeCaNumber: ppe?.ca_number || "",
        quantity: data.q || 1,
        reason: data.r || "Entrega Remota",
        authMethod,
        signatureBase64: signatureDataUrl,
        ipAddress,
        location,
        validationHash
      })
      setLastPdfUrl(URL.createObjectURL(pdfBlob))
      setIsSaved(true)
    } catch (err) {
      console.error(err)
      alert("Erro ao salvar assinatura.")
    } finally {
      setIsSaving(false)
    }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-10 h-10 animate-spin text-[#8B1A1A] mb-4" />
        <p className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">Validando Token de Assinatura...</p>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">{error}</h2>
        <p className="text-slate-500 mt-2">Por favor, solicite um novo link ao gestor do SESMT.</p>
    </div>
  )

  if (isSaved) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center animate-in zoom-in">
        <div className="bg-green-100 p-4 rounded-full mb-6 text-green-600">
          <ShieldCheck className="w-16 h-16" />
        </div>
        <h2 className="text-2xl font-black text-slate-800 mb-2 uppercase tracking-tighter">Assinatura Confirmada</h2>
        <p className="text-slate-500 max-w-md italic text-sm">O comprovante foi enviado ao servidor e está disponível para download.</p>
        <div className="mt-8 flex flex-col gap-4 w-full max-w-xs">
          {lastPdfUrl && (
            <a href={lastPdfUrl} target="_blank" download={`comprovante_antares.pdf`} className="px-8 py-4 bg-[#8B1A1A] text-white rounded-xl font-bold shadow-lg flex items-center justify-center gap-2">
              <FileDown className="w-5 h-5" /> Baixar Comprovante
            </a>
          )}
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pode fechar esta janela agora.</p>
        </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 pt-12">
        <div className="w-full max-w-lg space-y-6">
            <div className="text-center space-y-2">
                <div className="inline-block bg-[#8B1A1A] text-white text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] mb-2">Assinatura Digital Remota</div>
                <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Confirmação de Recebimento</h1>
                <p className="text-slate-500 text-sm font-medium">Empresa: {COMPANY_CONFIG.name}</p>
            </div>

            <div className="bg-white rounded-3xl p-6 shadow-xl shadow-slate-200/50 border border-slate-200 space-y-6">
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Itens a serem assinados:</p>
                    <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-800">{ppe?.name}</span>
                        <span className="bg-slate-200 text-slate-600 text-[10px] font-black px-2 py-1 rounded">Qtd: {data.q}</span>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">C.A.: {ppe?.ca_number}</p>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button onClick={() => setAuthMethod('manual')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-all ${authMethod === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>
                        <PenLine className="w-4 h-4" /> Manual
                    </button>
                    <button onClick={() => setAuthMethod('facial')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-all ${authMethod === 'facial' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
                        <Fingerprint className="w-4 h-4" /> Biometria
                    </button>
                </div>

                {authMethod === 'manual' ? (
                    <div className="space-y-4 animate-in fade-in">
                        <div className="flex justify-between items-center">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Assine no espaço abaixo:</label>
                            <button onClick={() => sigCanvas.current?.clear()} className="text-[10px] font-black text-[#8B1A1A] uppercase italic">Limpar</button>
                        </div>
                        <div className="bg-white rounded-2xl border-2 border-slate-100 h-64 overflow-hidden">
                            <SignatureCanvas ref={sigCanvas} canvasProps={{ className: 'w-full h-full' }} />
                        </div>
                        <button onClick={() => {
                            if (sigCanvas.current?.isEmpty()) return alert("Assine antes de confirmar.")
                            saveDelivery(sigCanvas.current!.getTrimmedCanvas().toDataURL())
                        }} disabled={isSaving} className="w-full bg-[#8B1A1A] text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-lg disabled:opacity-50">
                            {isSaving ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : "Confirmar Recebimento"}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4 animate-in zoom-in-95">
                        {!employee?.face_descriptor ? (
                             <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl text-center space-y-3">
                                <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto" />
                                <p className="text-amber-800 font-bold text-sm">Biometria não cadastrada</p>
                                <p className="text-amber-600 text-xs text-center">Utilize a Assinatura Manual para este colaborador.</p>
                                <button onClick={() => setAuthMethod('manual')} className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg text-[10px] font-black uppercase">Mudar para Manual</button>
                             </div>
                        ) : (
                            <FaceCamera 
                                targetDescriptor={new Float32Array(employee.face_descriptor)}
                                onCapture={(desc, img) => saveDelivery(img)}
                                onCancel={() => setAuthMethod('manual')}
                            />
                        )}
                    </div>
                )}
            </div>
            
            <p className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] pb-10">
                Segurança Certificada por Antares Digital SESMT
            </p>
        </div>
    </div>
  )
}

export default function RemoteDeliveryPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-red-600" /></div>}>
            <RemoteDeliveryContent />
        </Suspense>
    )
}
