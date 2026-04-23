"use client"

import { useState, useRef, useEffect } from "react"
import { Users, AlertTriangle, Search, CheckCircle2, FileDown, Loader2, ArrowRightLeft, ShieldAlert, Fingerprint, PenLine } from "lucide-react"
import SignatureCanvas from "react-signature-canvas"
import jsPDF from "jspdf"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { api } from "@/services/api"
import { Employee, PPE, Workplace, DeliveryWithRelations } from "@/types/database"
import { FaceCamera } from "@/components/ui/FaceCamera"

export default function ReturnsPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [ppes, setPpes] = useState<PPE[]>([])
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
  
  // Auth
  const [authMethod, setAuthMethod] = useState<'manual' | 'facial'>('manual')
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const [empData, ppeData] = await Promise.all([
          api.getEmployees(),
          api.getPpes()
        ])
        setEmployees(empData.filter(e => e.active))
        setPpes(ppeData.filter(p => p.active))
      } catch (err) {
        console.error("Erro", err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

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

  const clearSignature = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear()
    }
  }

  const generateReceiptPDF = (signatureBase64: string, newDeliveryId?: string) => {
    const doc = new jsPDF()
    doc.setFillColor(139, 26, 26)
    doc.rect(0, 0, 210, 30, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(18)
    doc.setFont("helvetica", "bold")
    doc.text("RECIBO DE BAIXA / SUBSTITUIÇÃO E.P.I.", 105, 18, { align: "center" })

    doc.setTextColor(0, 0, 0)
    doc.setFontSize(12)
    doc.text("DADOS DO COLABORADOR", 15, 40)
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.text(`Nome: ${selectedEmployee?.full_name}`, 15, 46)
    doc.text(`CPF: ${selectedEmployee?.cpf}`, 15, 51)

    doc.setFontSize(12)
    doc.setFont("helvetica", "bold")
    doc.text("ITEM DEVOLVIDO / BAIXADO", 15, 65)
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.text(`Equipamento: ${deliveryToReturn?.ppe?.name}`, 15, 71)
    doc.text(`Motivo da Baixa: ${returnMotive}`, 15, 76)

    if (needsReplacement && replacementPpeId) {
      const newPpe = ppes.find(p => p.id === replacementPpeId)
      doc.setFontSize(12)
      doc.setFont("helvetica", "bold")
      doc.text("NOVO ITEM ENTREGUE (SUBSTITUIÇÃO)", 15, 90)
      doc.setFontSize(10)
      doc.setFont("helvetica", "normal")
      doc.text(`Equipamento: ${newPpe?.name} (CA ${newPpe?.ca_number})`, 15, 96)
    }

    const term = needsReplacement 
      ? "Confirmo a devolução do item antigo e o recebimento do novo equipamento listado acima em perfeitas condições."
      : "Confirmo a devolução do item antigo, encerrando minha responsabilidade sobre o mesmo."
    
    doc.setFont("helvetica", "bold")
    doc.text("TERMO DE ACEITE", 15, 110)
    doc.setFont("helvetica", "normal")
    doc.text(doc.splitTextToSize(term, 180), 15, 116)

    doc.rect(15, 130, 180, 50)
    doc.addImage(signatureBase64, 'PNG', 65, 135, 80, 25)
    doc.text(`Assinatura (${authMethod}): ${selectedEmployee?.full_name}`, 105, 175, { align: "center" })

    return doc.output('blob')
  }

  const saveReturn = async (signatureDataUrl: string) => {
    if (!deliveryToReturn || !selectedEmployee) return
    
    if (needsReplacement && !replacementPpeId) {
      alert("Por favor, selecione o novo EPI para substituição.")
      return
    }

    try {
      setIsSaving(true)
      
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
          signature_url: null
        }, signatureFile)
      }

      const pdfBlob = generateReceiptPDF(signatureDataUrl)
      setLastPdfUrl(URL.createObjectURL(pdfBlob))
      setIsSaved(true)

    } catch (err) {
      console.error(err)
      alert("Erro ao processar a baixa/substituição.")
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
        <p className="text-slate-500 mb-8">Baixa e/ou substituição registrada com sucesso.</p>
        
        <div className="flex gap-4">
          <a href={lastPdfUrl!} target="_blank" download="recibo_baixa.pdf" className="bg-[#8B1A1A] text-white px-6 py-3 rounded-xl font-bold flex items-center">
            <FileDown className="w-5 h-5 mr-2" /> Baixar Recibo
          </a>
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
          Baixas e Substituições
        </h1>
        <p className="text-slate-500 font-medium text-sm">Devolução e troca de equipamentos desgastados.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Coluna 1: Colaboradores */}
        <div className="lg:col-span-1 bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col h-[70vh]">
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
                <span className="text-[9px] text-slate-400 font-bold">{emp.cpf}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Coluna 2: Ação */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl shadow-sm p-6 sm:p-8 min-h-[70vh]">
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
                    <select 
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl p-4 font-bold outline-none focus:border-[#8B1A1A]"
                      value={returnMotive}
                      onChange={(e) => setReturnMotive(e.target.value)}
                    >
                      <option value="Desgaste/Validade">Desgaste ou Fim da Validade (Requer Novo)</option>
                      <option value="Dano">Dano / Quebra (Requer Novo)</option>
                      <option value="Perda">Perda / Extravio (Requer Novo)</option>
                      <option value="Demissão">Demissão / Desligamento (Não requer novo)</option>
                      <option value="Erro de Entrega">Erro de Lançamento (Cancelar entrega)</option>
                    </select>
                  </div>

                  {needsReplacement && (
                    <div className="space-y-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                      <label className="text-[10px] font-black text-blue-800 uppercase tracking-widest flex items-center">
                        <AlertTriangle className="w-3 h-3 mr-1" /> Selecione o EPI Substituto (Nova Entrega)
                      </label>
                      <select 
                        className="w-full bg-white border border-blue-200 rounded-xl p-3 font-bold text-sm outline-none focus:border-blue-500"
                        value={replacementPpeId}
                        onChange={(e) => setReplacementPpeId(e.target.value)}
                      >
                        <option value="">Selecione o EPI que será entregue agora...</option>
                        {ppes.map(p => <option key={p.id} value={p.id}>{p.name} (CA {p.ca_number})</option>)}
                      </select>
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
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button onClick={() => setAuthMethod('manual')} className={`flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-all ${authMethod === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>
                      <PenLine className="w-4 h-4" /> Manual
                    </button>
                    <button onClick={() => setAuthMethod('facial')} className={`flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-all ${authMethod === 'facial' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
                      <Fingerprint className="w-4 h-4" /> Biometria
                    </button>
                  </div>

                  {authMethod === 'manual' ? (
                    <div className="space-y-3">
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
                        <FaceCamera 
                          targetDescriptor={new Float32Array(selectedEmployee.face_descriptor)}
                          onCapture={(desc, img) => saveReturn(img)}
                          onCancel={() => setAuthMethod('manual')}
                        />
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
