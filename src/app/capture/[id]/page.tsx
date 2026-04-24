"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Camera, CheckCircle2, Loader2, AlertTriangle } from "lucide-react"
import Image from "next/image"
import { FaceCamera } from "@/components/ui/FaceCamera"

export default function RemoteCapturePage() {
  const params = useParams()
  const employeeId = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [employee, setEmployee] = useState<any>(null)
  
  const [isCapturing, setIsCapturing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  useEffect(() => {
    async function loadEmployee() {
      try {
        const res = await fetch(`/api/remote-capture?id=${employeeId}`)
        if (!res.ok) {
          throw new Error("Colaborador não encontrado ou erro na requisição.")
        }
        const data = await res.json()
        setEmployee(data)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    
    if (employeeId) {
      loadEmployee()
    }
  }, [employeeId])

  const handleCapture = async (face_descriptor: Float32Array, photo_url: string) => {
    setIsCapturing(false)
    setIsSaving(true)
    
    try {
      const res = await fetch('/api/remote-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: employeeId,
          photo_url,
          face_descriptor: Array.from(face_descriptor)
        })
      })

      if (!res.ok) {
        throw new Error("Erro ao salvar a biometria.")
      }

      setIsSuccess(true)
    } catch (err: any) {
      alert("Falha: " + err.message)
    } finally {
      setIsSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#8B1A1A]" />
      </div>
    )
  }

  if (error || !employee) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl text-center max-w-md w-full">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-black text-slate-800 uppercase tracking-tighter mb-2">Erro no Link</h1>
          <p className="text-slate-500 font-medium">{error}</p>
        </div>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4 animate-in fade-in zoom-in duration-500">
        <CheckCircle2 className="w-24 h-24 text-green-500 mb-6" />
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter mb-2 text-center">Biometria Salva!</h1>
        <p className="text-slate-500 text-center max-w-sm mb-8">
          Sua foto foi registrada com sucesso no sistema. Você já pode fechar esta tela.
        </p>
      </div>
    )
  }

  if (isCapturing) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl overflow-hidden shadow-2xl relative">
          <div className="absolute top-0 left-0 w-full p-4 z-10 flex justify-between items-center bg-gradient-to-b from-black/50 to-transparent">
            <h3 className="text-white font-black uppercase text-sm tracking-widest shadow-black">Captura Facial</h3>
            <button onClick={() => setIsCapturing(false)} className="text-white text-xs font-bold bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm">Cancelar</button>
          </div>
          <div className="h-[60vh] bg-slate-900">
             <FaceCamera 
                onCapture={handleCapture}
                onCancel={() => setIsCapturing(false)}
             />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 flex flex-col items-center justify-center">
      <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
          <Camera className="w-8 h-8 text-[#8B1A1A]" />
        </div>
        
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Cadastro de Biometria</h1>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Antares SESMT Digital</p>
        </div>

        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Colaborador</p>
          <p className="font-black text-slate-800 uppercase text-lg">{employee.full_name}</p>
          <p className="text-xs text-slate-500">{employee.cpf}</p>
        </div>

        {employee.photo_url && (
          <div className="flex flex-col items-center gap-2">
            <div className="text-[10px] text-orange-500 font-bold uppercase tracking-widest flex items-center gap-1 bg-orange-50 px-3 py-1 rounded-full border border-orange-200">
              <AlertTriangle className="w-3 h-3" /> Você já possui biometria
            </div>
            <p className="text-xs text-slate-500">Fazer uma nova captura irá substituir sua foto atual.</p>
          </div>
        )}

        <button 
          onClick={() => setIsCapturing(true)}
          disabled={isSaving}
          className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white py-4 rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl shadow-red-900/20 border-b-4 border-red-900 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSaving ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Salvando...</>
          ) : (
            <><Camera className="w-5 h-5" /> Iniciar Câmera</>
          )}
        </button>

        <p className="text-[9px] text-slate-400 italic">
          Certifique-se de estar em um local bem iluminado e retire óculos escuros ou bonés.
        </p>
      </div>
    </div>
  )
}
