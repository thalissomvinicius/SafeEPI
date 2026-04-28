"use client"

import { useState, useRef, useEffect } from "react"
import Image from "next/image"
import { Camera, Users, AlertTriangle, Search, CheckCircle2, ExternalLink, FileDown, Loader2, ArrowRightLeft, ShieldAlert, Fingerprint, PenLine } from "lucide-react"
import SignatureCanvas from "react-signature-canvas"
import { format } from "date-fns"
import { api } from "@/services/api"
import { Employee, PPE, DeliveryWithRelations, Workplace } from "@/types/database"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { COMPANY_CONFIG } from "@/config/company"
import { generateReturnPDF } from "@/utils/pdfGenerator"
import { formatCpf } from "@/utils/cpf"

export default function ReturnsPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [ppes, setPpes] = useState<PPE[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")

  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [activeDeliveries, setActiveDeliveries] = useState<DeliveryWithRelations[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)

  // Fluxo de Baixa
  const [step, setStep] = useState(1) // 1: Select, 2: Auth
  const [deliveryToReturn, setDeliveryToReturn] = useState<DeliveryWithRelations | null>(null)
  const [returnMotive, setReturnMotive] = useState("Desgaste/Validade")
  const [replacementPpeId, setReplacementPpeId] = useState("")
  const [replacementSearchTerm, setReplacementSearchTerm] = useState("")
  
  // Auth
  const [authMethod, setAuthMethod] = useState<'manual' | 'facial' | 'manual_facial'>('manual')
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [lastPdfFileName, setLastPdfFileName] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const [empData, ppeData, wpData] = await Promise.all([
          api.getEmployees(),
          api.getPpes(),
          api.getWorkplaces()
        ])
        setEmployees(empData.filter(e => e.active))
        setPpes(ppeData.filter(p => p.active))
        setWorkplaces(wpData)
      } catch (err) {
        console.error("Erro", err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  useEffect(() => {
    return () => {
      if (lastPdfUrl) {
        window.URL.revokeObjectURL(lastPdfUrl)
      }
    }
  }, [lastPdfUrl])

  const selectEmployee = async (emp: Employee) => {
    setSelectedEmployee(emp)
    setLoadingDeliveries(true)
    setDeliveryToReturn(null)
    setStep(1)
    setIsSaved(false)
    try {
      const history = await api.getEmployeeHistory(emp.id)
      setActiveDeliveries(history.filter(d => !d.returned_at))
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingDeliveries(false)
    }
  }

  const handleStartReturn = (delivery: DeliveryWithRelations) => {
    setDeliveryToReturn(delivery)
    setReturnMotive("Desgaste/Validade")
    setReplacementPpeId("")
    setStep(1)
  }

  const needsReplacement = returnMotive !== "Demissão" && returnMotive !== "Erro de Entrega"

  const filteredReplacementPpes = ppes.filter(ppe => 
    ppe.name.toLowerCase().includes(replacementSearchTerm.toLowerCase()) || 
    ppe.ca_number.includes(replacementSearchTerm)
  )

  const clearSignature = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear()
    }
  }

  const getEmployeePhotoBase64 = async () => {
    if (!selectedEmployee?.photo_url) return undefined
    try {
      const response = await fetch(selectedEmployee.photo_url)
      const blob = await response.blob()
      return await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      })
    } catch {
      return undefined
    }
  }

  const saveReturn = async (signatureDataUrl: string) => {
    if (!deliveryToReturn || !selectedEmployee) return
    if (authMethod === 'manual_facial' && !selectedEmployee.photo_url) {
      alert("Cadastre uma foto do colaborador antes de usar Foto + Assinatura.")
      return
    }
    
    if (needsReplacement && !replacementPpeId) {
      alert("Por favor, selecione o novo EPI para substituição.")
      return
    }

    try {
      setIsSaving(true)
      
      const newPpe = needsReplacement ? ppes.find(p => p.id === replacementPpeId) : undefined;
      const photoBase64 = authMethod === 'manual_facial' ? await getEmployeePhotoBase64() : undefined
      const persistedAuthMethod: 'manual' | 'facial' = authMethod === 'manual_facial' ? 'manual' : authMethod

      // 1. Dar Baixa no Antigo
      await api.returnDelivery(deliveryToReturn.id, returnMotive)

      // 2. Criar Nova Entrega se precisar
      if (needsReplacement && replacementPpeId) {
        const response = await fetch(signatureDataUrl)
        const blob = await response.blob()
        const signatureFile = new File([blob], "signature.png", { type: "image/png" })

        await api.saveDelivery({
          employee_id: selectedEmployee.id,
          ppe_id: replacementPpeId,
          workplace_id: selectedEmployee.workplace_id,
          reason: returnMotive === 'Perda' || returnMotive === 'Dano' ? 'Perda' : 'Substituição (Desgaste/Validade)',
          quantity: 1,
          ip_address: "Terminal de Baixas",
          auth_method: persistedAuthMethod,
          signature_url: null,
          delivery_date: new Date().toISOString()
        }, signatureFile)
      }

      const workplace = workplaces.find(w => w.id === selectedEmployee.workplace_id)
      const workplaceName = workplace?.name || "Sede"

      const pdfBlob = await generateReturnPDF({
        employeeName: selectedEmployee.full_name,
        employeeCpf: selectedEmployee.cpf,
        workplaceName: workplaceName,
        returnedItemName: deliveryToReturn.ppe?.name || "EPI",
        returnMotive: returnMotive,
        newItemName: newPpe?.name,
        newItemCa: newPpe?.ca_number,
        authMethod: authMethod,
        signatureBase64: signatureDataUrl,
        photoBase64,
      })
      
      const safeEmployee = (selectedEmployee.full_name || "Baixa")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
      const fileName = `Recibo_Baixa_${safeEmployee}_${format(new Date(), "ddMMyyyy")}.pdf`
      const pdfUrl = URL.createObjectURL(pdfBlob)

      setLastPdfUrl((prev) => {
        if (prev) {
          window.URL.revokeObjectURL(prev)
        }
        return pdfUrl
      })
      setLastPdfFileName(fileName)
      setIsSaved(true)

    } catch (err: unknown) {
      console.error(err)
      const message = err instanceof Error ? err.message : "Erro ao processar a baixa/substituição."
      alert(message)
    } finally {
      setIsSaving(false)
    }
  }

  const filteredEmployees = employees.filter(emp => 
    emp.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    emp.cpf.includes(searchTerm)
  )

  if (loading) return <div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-[#8B1A1A]" /></div>

  if (isSaved) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-center animate-in zoom-in">
        <CheckCircle2 className="w-20 h-20 text-green-500 mb-4" />
        <h2 className="text-2xl font-black text-slate-800 uppercase">Processo Concluído</h2>
        <p className="text-slate-400 text-xs font-medium mb-2">Escolha se deseja visualizar ou baixar o recibo em PDF.</p>
        <p className="text-slate-500 mb-8">Baixa e/ou substituição registrada com sucesso.</p>
        
        <div className="flex flex-col sm:flex-row gap-4">
          {lastPdfUrl && (
            <>
              <a href={lastPdfUrl} target="_blank" rel="noopener noreferrer" className="border border-slate-200 bg-white text-slate-700 px-6 py-3 rounded-xl font-bold flex items-center justify-center">
                <ExternalLink className="w-5 h-5 mr-2 text-[#8B1A1A]" /> Visualizar PDF
              </a>
              <a href={lastPdfUrl} download={lastPdfFileName || "recibo_baixa.pdf"} className="bg-[#8B1A1A] text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center">
                <FileDown className="w-5 h-5 mr-2" /> Baixar PDF
              </a>
            </>
          )}
          <button onClick={() => { setIsSaved(false); setDeliveryToReturn(null); selectEmployee(selectedEmployee!); }} className="border border-slate-200 px-6 py-3 rounded-xl font-bold">
            Nova Baixa
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 pb-24 md:pb-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter flex items-center">
          <ArrowRightLeft className="w-6 h-6 mr-2 text-[#8B1A1A]" /> 
          Baixas e Substituições {COMPANY_CONFIG.shortName}
        </h1>
        <p className="text-slate-500 font-medium text-sm">Devolução e troca de equipamentos desgastados no {COMPANY_CONFIG.systemName}.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Coluna 1: Colaboradores */}
        <div className="lg:col-span-1 bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col h-[40vh] sm:h-[50vh] lg:h-[70vh]">
          <div className="p-4 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Buscar colaborador..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:border-[#8B1A1A] outline-none"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filteredEmployees.map(emp => (
              <button 
                key={emp.id}
                onClick={() => selectEmployee(emp)}
                className={`w-full text-left p-3 rounded-xl mb-1 transition-all flex flex-col ${selectedEmployee?.id === emp.id ? 'bg-[#8B1A1A]/10 border border-[#8B1A1A]/30' : 'hover:bg-slate-50 border border-transparent'}`}
              >
                <span className={`font-black text-xs uppercase tracking-tighter truncate w-full ${selectedEmployee?.id === emp.id ? 'text-[#8B1A1A]' : 'text-slate-700'}`}>{emp.full_name}</span>
                <span className="text-[9px] text-slate-400 font-bold">{formatCpf(emp.cpf)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Coluna 2: Ação */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl shadow-sm p-6 sm:p-8 min-h-[40vh] lg:min-h-[70vh]">
          {!selectedEmployee ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
              <Users className="w-16 h-16 text-slate-300 mb-4" />
              <p className="font-bold text-slate-500 uppercase tracking-widest text-sm">Selecione um Colaborador<br/>para visualizar os EPIs em posse.</p>
            </div>
          ) : !deliveryToReturn ? (
            <div className="animate-in fade-in">
              <h2 className="text-sm font-black uppercase text-slate-800 tracking-widest mb-4 border-b border-slate-100 pb-2">EPIs em posse de {selectedEmployee.full_name}</h2>
              {loadingDeliveries ? <Loader2 className="w-6 h-6 animate-spin text-[#8B1A1A]" /> : (
                <div className="grid gap-3">
                  {activeDeliveries.length === 0 ? (
                    <p className="text-slate-400 text-xs font-bold uppercase">Nenhum EPI pendente de devolução.</p>
                  ) : activeDeliveries.map(delivery => (
                    <div key={delivery.id} className="border border-slate-200 rounded-2xl p-4 flex justify-between items-center hover:border-slate-300 transition-colors">
                      <div>
                        <p className="font-bold text-slate-800 text-sm">{delivery.ppe?.name}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest">Entregue em: {format(new Date(delivery.delivery_date), "dd/MM/yyyy")}</p>
                      </div>
                      <button 
                        onClick={() => handleStartReturn(delivery)}
                        className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-slate-900/10"
                      >
                        Baixar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="animate-in slide-in-from-right-4 space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <h2 className="text-sm font-black uppercase text-slate-800 tracking-widest">Processar Baixa</h2>
                <button onClick={() => setDeliveryToReturn(null)} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase">Cancelar</button>
              </div>

              {step === 1 && (
                <div className="space-y-6">
                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Item sendo devolvido</p>
                    <p className="font-bold text-slate-800">{deliveryToReturn.ppe?.name}</p>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Motivo da Baixa</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        { val: "Desgaste/Validade", label: "Desgaste ou Fim da Validade" },
                        { val: "Dano", label: "Dano / Quebra" },
                        { val: "Perda", label: "Perda / Extravio" },
                        { val: "Demissão", label: "Demissão / Desligamento" },
                        { val: "Erro de Entrega", label: "Erro de Lançamento" }
                      ].map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => setReturnMotive(opt.val)}
                          className={`p-3 rounded-2xl border text-xs font-black uppercase tracking-tight transition-all flex flex-col items-center justify-center text-center gap-1 ${returnMotive === opt.val ? 'border-[#8B1A1A] bg-red-50 text-[#8B1A1A] shadow-md shadow-red-900/10' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'}`}
                        >
                          <span>{opt.label}</span>
                          <span className={`text-[9px] font-bold ${returnMotive === opt.val ? 'text-red-400' : 'text-slate-400'}`}>
                            {['Demissão', 'Erro de Entrega'].includes(opt.val) ? '(Não requer novo)' : '(Requer Novo)'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {needsReplacement && (
                    <div className="space-y-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                      <label className="text-[10px] font-black text-blue-800 uppercase tracking-widest flex items-center">
                        <AlertTriangle className="w-3 h-3 mr-1" /> Selecione o EPI Substituto (Nova Entrega)
                      </label>
                      <div className="flex flex-col gap-3 relative">
                        <input 
                          type="text"
                          placeholder="Busca por CA ou Nome..."
                          value={replacementSearchTerm}
                          onChange={(e) => setReplacementSearchTerm(e.target.value)}
                          className="w-full bg-white border border-blue-200 text-slate-900 rounded-2xl px-5 py-4 outline-none focus:border-blue-500 focus:bg-white transition-all font-bold text-sm"
                        />
                        
                        <div className="bg-white border border-blue-200 rounded-2xl overflow-hidden shadow-sm">
                          <div className="max-h-48 overflow-y-auto divide-y divide-blue-50">
                            {filteredReplacementPpes.length === 0 ? (
                              <div className="p-6 text-center text-xs text-blue-400 font-bold uppercase tracking-widest">Nenhum EPI encontrado</div>
                            ) : (
                              filteredReplacementPpes.map(ppe => {
                                const isSelected = replacementPpeId === ppe.id
                                
                                return (
                                  <div 
                                    key={ppe.id}
                                    onClick={() => setReplacementPpeId(ppe.id)}
                                    className={`p-4 cursor-pointer transition-colors flex items-center justify-between ${isSelected ? 'bg-blue-50 border-l-4 border-blue-500' : 'hover:bg-blue-50/50 border-l-4 border-transparent'}`}
                                  >
                                    <div>
                                      <p className={`font-black text-sm uppercase tracking-tight ${isSelected ? 'text-blue-800' : 'text-slate-700'}`}>
                                        {ppe.name}
                                      </p>
                                      <div className="flex items-center gap-2 mt-1.5">
                                        <span className="text-[10px] font-bold bg-blue-100/50 text-blue-600 px-2 py-0.5 rounded uppercase tracking-widest">
                                          CA {ppe.ca_number}
                                        </span>
                                      </div>
                                    </div>
                                    {isSelected && <CheckCircle2 className="w-5 h-5 text-blue-500" />}
                                  </div>
                                )
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <button 
                    onClick={() => setStep(2)}
                    className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white py-4 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-red-900/10"
                  >
                    Prosseguir para Assinatura
                  </button>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  {/* Tabs de Assinatura */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl">
                    <button onClick={() => setAuthMethod('manual')} className={`py-3 text-xs font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-all ${authMethod === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>
                      <PenLine className="w-4 h-4" /> Manual
                    </button>
                    <button onClick={() => setAuthMethod('manual_facial')} className={`py-3 text-xs font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-all ${authMethod === 'manual_facial' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-400'}`}>
                      <Camera className="w-4 h-4" /> Foto + Assinatura
                    </button>
                    <button onClick={() => setAuthMethod('facial')} className={`py-3 text-xs font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-all ${authMethod === 'facial' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
                      <Fingerprint className="w-4 h-4" /> Biometria
                    </button>
                  </div>

                  {authMethod === 'manual' || authMethod === 'manual_facial' ? (
                    <div className="space-y-3">
                      {authMethod === 'manual_facial' && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 flex items-center gap-3">
                          {selectedEmployee.photo_url ? (
                            <Image src={selectedEmployee.photo_url} alt="Foto do colaborador" width={44} height={44} className="w-11 h-11 rounded-xl object-cover border border-emerald-200" unoptimized />
                          ) : (
                            <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
                              <Camera className="w-5 h-5" />
                            </div>
                          )}
                          <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest leading-relaxed">O recibo vai sair com foto cadastrada e assinatura manual.</p>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Assinatura do Colaborador</label>
                        <button onClick={clearSignature} className="text-[10px] font-black text-[#8B1A1A] uppercase hover:underline">Limpar</button>
                      </div>
                      <div className="bg-white rounded-3xl overflow-hidden border-2 border-slate-100 shadow-inner h-64 touch-none">
                        <SignatureCanvas ref={sigCanvas} canvasProps={{ className: 'w-full h-full' }} penColor="#000000" />
                      </div>
                      <button 
                        disabled={isSaving}
                        onClick={() => {
                          if (!sigCanvas.current?.isEmpty()) saveReturn(sigCanvas.current!.getTrimmedCanvas().toDataURL("image/png"))
                          else alert("A assinatura é obrigatória.")
                        }}
                        className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white py-4 rounded-xl font-black uppercase tracking-[0.2em]"
                      >
                        {isSaving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Confirmar e Finalizar"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {!selectedEmployee.face_descriptor ? (
                        <div className="bg-amber-50 p-6 rounded-2xl text-center space-y-3 border border-amber-200">
                          <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto" />
                          <p className="text-amber-800 font-bold text-sm">Biometria não cadastrada</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Identidade Certificada</span>
                            <div className="flex items-center gap-2">
                              {selectedEmployee.photo_url && (
                                <Image src={selectedEmployee.photo_url} alt="User" width={24} height={24} className="w-6 h-6 rounded-full border border-slate-200 object-cover" unoptimized />
                              )}
                              <span className="text-[10px] font-bold text-slate-500">{selectedEmployee.full_name}</span>
                            </div>
                          </div>
                          <FaceCamera 
                            targetDescriptor={new Float32Array(selectedEmployee.face_descriptor)}
                            onCapture={(desc, img) => saveReturn(img)}
                            onCancel={() => setAuthMethod('manual')}
                          />
                        </>
                      )}
                    </div>
                  )}
                  
                  <div className="pt-2 text-center">
                    <button onClick={() => setStep(1)} className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Voltar</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
