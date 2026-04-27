"use client"

import { useState, useEffect } from "react"
import { CheckCircle2, Award, Calendar, Search, Plus, X, Loader2, FileDown, Camera, PenTool, ShieldAlert, Users } from "lucide-react"
import { api } from "@/services/api"
import { Employee, TrainingWithRelations } from "@/types/database"
import { format, addYears } from "date-fns"
import { toast } from "sonner"
import { useRef } from "react"
import SignatureCanvas from "react-signature-canvas"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { generateTrainingCertificate } from "@/utils/pdfGenerator"

export default function TrainingPage() {
  const [trainings, setTrainings] = useState<TrainingWithRelations[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Form State
  const [formData, setFormData] = useState({
    employee_id: "",
    training_name: "Uso e Guarda de EPI (NR-06)",
    completion_date: format(new Date(), "yyyy-MM-dd"),
  })
  const [customTrainingName, setCustomTrainingName] = useState("")

  // TST / Instructor Modal State
  const [step, setStep] = useState<1 | 2 | 3>(1) // 1=Course, 2=Instructor, 3=Signature
  const [tstSelectedEmployee, setTstSelectedEmployee] = useState<Employee | null>(null)
  const [tstSearchTerm, setTstSearchTerm] = useState("")
  const [tstRole, setTstRole] = useState("Técnico de Segurança do Trabalho")
  const [tstAuthMethod, setTstAuthMethod] = useState<'manual' | 'facial'>('manual')
  const [tstSignatureBase64, setTstSignatureBase64] = useState<string | null>(null)
  const [isFaceCameraTstOpen, setIsFaceCameraTstOpen] = useState(false)
  const tstSigCanvas = useRef<SignatureCanvas | null>(null)

  const loadData = async () => {
    try {
      setLoading(true)
      const [tData, eData] = await Promise.all([
        api.getTrainings(),
        api.getEmployees()
      ])
      setTrainings(tData)
      setEmployees(eData.filter(e => e.active))
      if (eData.length > 0) setFormData(prev => ({ ...prev, employee_id: eData[0].id }))
    } catch (error) {
      console.error("Erro ao carregar treinamentos:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const fetchInitialData = async () => {
        await loadData()
    }
    fetchInitialData()
  }, [])

  const handleAddTraining = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.employee_id) return
    if (!tstSignatureBase64 || !tstSelectedEmployee) {
      toast.error("É necessário colher a assinatura do instrutor.")
      return
    }

    let finalTrainingName = formData.training_name
    if (formData.training_name === "Outro" && !customTrainingName.trim()) {
        toast.error("Por favor, especifique o nome do treinamento.")
        return
    }
    if (formData.training_name === "Outro") {
        finalTrainingName = customTrainingName
    }

    try {
      setIsSaving(true)
      const completionDate = new Date(formData.completion_date)
      const expiryDate = addYears(completionDate, 1) // Validade padrão de 1 ano

      await api.addTraining({
        employee_id: formData.employee_id,
        training_name: finalTrainingName,
        completion_date: formData.completion_date,
        expiry_date: format(expiryDate, "yyyy-MM-dd"),
        status: "Válido",
        instructor_id: tstSelectedEmployee.id,
        instructor_name: tstSelectedEmployee.full_name,
        instructor_role: tstRole,
        signature_url: tstSignatureBase64,
        auth_method: tstAuthMethod
      })

      await loadData()
      setIsModalOpen(false)
      resetForm()
      toast.success("Treinamento registrado com sucesso!")
    } catch (error) {
      console.error("Erro ao salvar treinamento:", error)
      toast.error("Erro ao salvar treinamento no banco de dados.")
    } finally {
      setIsSaving(false)
    }
  }

  const resetForm = () => {
    setStep(1)
    setTstSelectedEmployee(null)
    setTstSearchTerm("")
    setTstSignatureBase64(null)
    setTstAuthMethod('manual')
    setCustomTrainingName("")
    setFormData(prev => ({ ...prev, training_name: "Uso e Guarda de EPI (NR-06)" }))
  }

  const handleSelectTst = async (emp: Employee) => {
    setTstSelectedEmployee(emp)
    setTstRole(emp.job_title || "Técnico de Segurança do Trabalho")
    
    if (emp.photo_url) {
      try {
        const res = await fetch(emp.photo_url)
        const blob = await res.blob()
        const b64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        })
        setTstSignatureBase64(b64)
        setTstAuthMethod('facial')
        setStep(3) // Skip to step 3 to confirm
      } catch {
        setTstSignatureBase64(null)
        setStep(3)
      }
    } else {
      setTstSignatureBase64(null)
      setStep(3)
    }
  }

  const downloadCertificate = (rec: TrainingWithRelations) => {
    generateTrainingCertificate({
      employeeName: rec.employee?.full_name || "N/A",
      employeeCpf: rec.employee?.cpf || "N/A",
      trainingName: rec.training_name,
      completionDate: rec.completion_date,
      expiryDate: rec.expiry_date,
      instructorName: rec.instructor_name || "N/A",
      instructorRole: rec.instructor_role || "Técnico de Segurança",
      signatureBase64: rec.signature_url || undefined
    })
  }

  const filteredTrainings = trainings.filter(t => 
    t.training_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.employee?.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
              <Award className="w-6 h-6 mr-2 text-[#8B1A1A]" />
              Treinamentos Antares
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Gestão de competências e normas regulamentadoras (NRs).</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="w-full sm:w-auto bg-[#8B1A1A] hover:bg-[#681313] text-white shadow-lg shadow-red-900/20 px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center whitespace-nowrap"
        >
          <Plus className="w-4 h-4 mr-2" />
          Registrar Treinamento
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-200 bg-slate-50/30">
          <div className="relative max-w-md">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar treinamento ou colaborador..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              title="Buscar treinamento"
              aria-label="Buscar treinamento"
              className="w-full bg-white border border-slate-200 text-slate-900 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-[#8B1A1A] transition-all"
            />
          </div>
        </div>
        
        <div className="overflow-x-auto min-h-[300px]">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#8B1A1A]" />
                <p className="text-sm font-medium italic">Acessando registros do Supabase...</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-[10px] text-slate-400 bg-white uppercase tracking-[0.2em] border-b border-slate-100 font-black">
                <tr>
                  <th className="px-6 py-5">Colaborador</th>
                  <th className="px-6 py-4">Treinamento / Norma</th>
                  <th className="px-6 py-4">Realizado em</th>
                   <th className="px-6 py-4">Válido até</th>
                   <th className="px-6 py-4 text-center">Status</th>
                   <th className="px-6 py-4 text-right">Ações</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 font-medium">
                {filteredTrainings.map((rec, i) => (
                  <tr key={i} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-5 font-bold text-slate-800">{rec.employee?.full_name}</td>
                    <td className="px-6 py-4 text-slate-600 italic">{rec.training_name}</td>
                    <td className="px-6 py-4 text-slate-400">
                      <div className="flex items-center">
                        <Calendar className="w-3 h-3 mr-2" /> {new Date(rec.completion_date).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-400">{new Date(rec.expiry_date).toLocaleDateString()}</td>
                     <td className="px-6 py-4 text-center">
                       <span className={`px-3 py-1 text-[10px] font-black uppercase rounded-full border ${
                         rec.status === 'Válido' 
                           ? 'bg-green-50 text-green-700 border-green-200' 
                           : 'bg-amber-50 text-amber-700 border-amber-200'
                       }`}>
                         {rec.status}
                       </span>
                     </td>
                     <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => downloadCertificate(rec)}
                          title="Baixar Certificado"
                          className="p-2 bg-slate-100 hover:bg-[#8B1A1A] hover:text-white text-slate-600 rounded-lg transition-all"
                        >
                          <FileDown className="w-4 h-4" />
                        </button>
                     </td>
                  </tr>
                ))}
                {filteredTrainings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-slate-400 italic font-medium">
                        Nenhum treinamento registrado no banco de dados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center">
        <CheckCircle2 className="w-12 h-12 text-[#8B1A1A]/20 mb-4" />
        <h3 className="font-bold text-slate-800 uppercase tracking-tighter">Certificação NR-01</h3>
        <p className="text-sm text-slate-400 max-w-md mt-2">
          Treinamentos periódicos garantem a segurança e reduzem o risco de acidentes de trabalho.
        </p>
      </div>

      {/* Modal Adicionar Treinamento */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="flex justify-between items-center p-6 border-b border-slate-100 shrink-0">
              <div>
                  <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl">Novo Certificado</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                    Etapa {step} de 3 — {step === 1 ? "Dados do Curso" : step === 2 ? "Selecionar Instrutor" : "Assinatura do TST"}
                  </p>
              </div>
              <button 
                onClick={() => { setIsModalOpen(false); resetForm(); }} 
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Fechar modal"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {step === 1 && (
                  <form onSubmit={(e) => { e.preventDefault(); setStep(2); }} className="p-8 space-y-5">
                    <div className="space-y-2">
                      <label id="label-colaborador" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Colaborador Treinado</label>
                      <select 
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold"
                        value={formData.employee_id}
                        title="Selecionar Colaborador"
                        aria-labelledby="label-colaborador"
                        onChange={(e) => setFormData({...formData, employee_id: e.target.value})}
                        required
                      >
                        <option value="">Selecione um colaborador...</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label id="label-treinamento" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo de Treinamento</label>
                      <select 
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold"
                        value={formData.training_name}
                        title="Tipo de Treinamento"
                        aria-labelledby="label-treinamento"
                        onChange={(e) => setFormData({...formData, training_name: e.target.value})}
                      >
                        <option>Uso e Guarda de EPI (NR-06)</option>
                        <option>Integração de Segurança (NR-01)</option>
                        <option>Trabalho em Altura (NR-35)</option>
                        <option>Segurança Elétrica (NR-10)</option>
                        <option value="Outro">Outro (Especificar...)</option>
                      </select>
                      
                      {formData.training_name === "Outro" && (
                          <input 
                            type="text"
                            placeholder="Digite o nome da Norma ou Treinamento"
                            value={customTrainingName}
                            onChange={(e) => setCustomTrainingName(e.target.value)}
                            className="w-full mt-2 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold"
                            autoFocus
                          />
                      )}
                    </div>

                    <div className="space-y-2">
                      <label id="label-data" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Realização</label>
                      <input 
                        type="date" 
                        value={formData.completion_date}
                        title="Data de Realização"
                        aria-labelledby="label-data"
                        onChange={(e) => setFormData({...formData, completion_date: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold" 
                      />
                    </div>

                    <div className="pt-6">
                      <button 
                        type="submit"
                        className="w-full px-4 py-4 text-xs font-black text-white bg-[#8B1A1A] hover:bg-[#681313] rounded-xl uppercase tracking-widest transition-all flex items-center justify-center shadow-lg shadow-red-900/10"
                      >
                        Próxima Etapa: Instrutor
                      </button>
                    </div>
                  </form>
                )}

                {step === 2 && (
                  <div className="p-8 space-y-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3">
                      <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                      <p className="text-[10px] text-amber-800 font-bold uppercase tracking-widest">
                        Selecione o Responsável Técnico que ministrou este treinamento.
                      </p>
                    </div>

                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={tstSearchTerm}
                        onChange={e => setTstSearchTerm(e.target.value)}
                        placeholder="Buscar instrutor..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm font-bold focus:border-[#8B1A1A] outline-none"
                      />
                    </div>

                    <div className="max-h-[300px] overflow-y-auto space-y-2 custom-scrollbar pr-1">
                      {employees
                        .filter(e => e.active && (
                          e.full_name.toLowerCase().includes(tstSearchTerm.toLowerCase()) ||
                          e.cpf.includes(tstSearchTerm)
                        ))
                        .map(emp => (
                          <button
                            key={emp.id}
                            onClick={() => handleSelectTst(emp)}
                            className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-[#8B1A1A]/30 hover:bg-red-50/30 transition-all text-left group"
                          >
                            {emp.photo_url ? (
                              <div className="relative">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={emp.photo_url} alt={emp.full_name} className="w-10 h-10 rounded-full object-cover border-2 border-green-500" />
                                <div className="absolute -bottom-1 -right-1 bg-green-500 text-white rounded-full p-0.5">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                </div>
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border-2 border-slate-200">
                                <Users className="w-5 h-5" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-black text-slate-800 text-sm truncate">{emp.full_name}</p>
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{emp.job_title} • CPF: {emp.cpf}</p>
                            </div>
                            {emp.photo_url && (
                              <span className="text-[8px] font-black text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100 uppercase tracking-widest flex-shrink-0">✓ Foto</span>
                            )}
                          </button>
                        ))
                      }
                    </div>

                    <button
                      onClick={() => setStep(1)}
                      className="w-full py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                    >
                      ← Voltar para Dados do Curso
                    </button>
                  </div>
                )}

                {step === 3 && tstSelectedEmployee && (
                  <div className="p-8 space-y-5">
                    {/* Notice for Missing Photo */}
                    {!tstSelectedEmployee.photo_url && !tstSignatureBase64 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3 items-start">
                        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-amber-800 font-bold uppercase tracking-widest leading-relaxed">
                          O instrutor selecionado não possui foto pré-cadastrada. Capture uma biometria agora ou utilize a assinatura manual.
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                      <button
                        onClick={() => { setTstAuthMethod('manual'); setTstSignatureBase64(null); setIsFaceCameraTstOpen(false); }}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${tstAuthMethod === 'manual' ? 'bg-white shadow text-slate-800' : 'text-slate-400'}`}
                      >
                        <PenTool className="w-3.5 h-3.5 inline mr-1" /> Assinatura Manual
                      </button>
                      <button
                        onClick={() => { setTstAuthMethod('facial'); setTstSignatureBase64(null); setIsFaceCameraTstOpen(true); }}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${tstAuthMethod === 'facial' ? 'bg-white shadow text-slate-800' : 'text-slate-400'}`}
                      >
                        <Camera className="w-3.5 h-3.5 inline mr-1" /> Foto Biométrica
                      </button>
                    </div>

                    {tstAuthMethod === 'manual' && !isFaceCameraTstOpen && (
                      <div className="space-y-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{tstSelectedEmployee.full_name} — Assine abaixo:</p>
                        {tstSignatureBase64 ? (
                          <div className="relative border-2 border-green-500 rounded-xl overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={tstSignatureBase64} alt="Assinatura" className="w-full h-32 object-contain bg-slate-50" />
                            <button
                              onClick={() => setTstSignatureBase64(null)}
                              className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-lg"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="border-2 border-dashed border-slate-300 rounded-xl overflow-hidden bg-slate-50">
                            <SignatureCanvas
                              ref={tstSigCanvas}
                              canvasProps={{ className: "w-full h-32 touch-none" }}
                              penColor="#1e293b"
                            />
                          </div>
                        )}
                        {!tstSignatureBase64 && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => tstSigCanvas.current?.clear()}
                              className="flex-1 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                            >
                              Limpar
                            </button>
                            <button
                              onClick={() => {
                                if (tstSigCanvas.current?.isEmpty()) {
                                  toast.error("Assine antes de confirmar.")
                                  return
                                }
                                setTstSignatureBase64(tstSigCanvas.current?.toDataURL('image/png') || null)
                              }}
                              className="flex-1 py-3 text-[10px] font-black text-white bg-[#8B1A1A] uppercase tracking-widest rounded-xl hover:bg-[#681313] transition-all"
                            >
                              Confirmar Assinatura
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {tstAuthMethod === 'facial' && (
                      <div className="space-y-3">
                        {tstSignatureBase64 ? (
                          <div className="relative border-2 border-green-500 rounded-xl overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={tstSignatureBase64} alt="Foto" className="w-full h-48 object-cover bg-slate-900" />
                            <button
                              onClick={() => { setTstSignatureBase64(null); setIsFaceCameraTstOpen(true); }}
                              className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-lg"
                            >
                              <X className="w-3 h-3" />
                            </button>
                            <div className="absolute bottom-2 left-2 text-[8px] font-black text-green-400 uppercase tracking-widest bg-green-900/80 px-2 py-1 rounded">✓ Biometria Capturada</div>
                          </div>
                        ) : (
                          <FaceCamera
                            onCapture={(_, img) => { setTstSignatureBase64(img); setIsFaceCameraTstOpen(false); }}
                            onCancel={() => { setIsFaceCameraTstOpen(false); setTstAuthMethod('manual'); }}
                          />
                        )}
                      </div>
                    )}

                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={() => setStep(2)}
                        className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-200 rounded-xl hover:bg-slate-50 transition-all"
                      >
                        ← Voltar
                      </button>
                      <button
                        onClick={handleAddTraining}
                        disabled={!tstSignatureBase64 || isSaving}
                        className="flex-1 py-4 text-[10px] font-black text-white bg-[#8B1A1A] hover:bg-[#681313] rounded-xl uppercase tracking-widest transition-all shadow-lg shadow-red-900/20 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Finalizar e Gerar Certificado
                      </button>
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
