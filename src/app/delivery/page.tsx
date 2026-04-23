"use client"

import { useState, useRef, useEffect } from "react"
import SignatureCanvas from "react-signature-canvas"
import { CheckCircle2, FileDown, Loader2, ShieldAlert, Fingerprint, PenLine } from "lucide-react"
import jsPDF from "jspdf"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { api } from "@/services/api"
import { Employee, PPE, Workplace } from "@/types/database"
import { FaceCamera } from "@/components/ui/FaceCamera"

export default function DeliveryPage() {
  const [step, setStep] = useState(1)
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  
  const [isSaved, setIsSaved] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Dados do banco
  const [employees, setEmployees] = useState<Employee[]>([])
  const [ppes, setPpes] = useState<PPE[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)

  // Estados dos formulários selecionados
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("")
  const [selectedPpeId, setSelectedPpeId] = useState("")
  const [ppeSearchTerm, setPpeSearchTerm] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState("")
  const [reason] = useState("Nova Entrega")

  // Biometria Facial
  const [authMethod, setAuthMethod] = useState<'manual' | 'facial'>('manual')

  useEffect(() => {
    async function loadOptions() {
      try {
        const [empData, ppeData, wpData] = await Promise.all([
          api.getEmployees(),
          api.getPpes(),
          api.getWorkplaces()
        ])
        setEmployees(empData.filter(e => e.active))
        setPpes(ppeData.filter(p => p.active))
        setWorkplaces(wpData)
        
        if (empData.length > 0) {
            setSelectedEmployeeId(empData[0].id)
            setSelectedWorkplaceId(empData[0].workplace_id || "")
        }
        if (ppeData.length > 0) setSelectedPpeId(ppeData[0].id)
      } catch (error) {
        console.error("Erro ao carregar opções:", error)
        alert("Ocorreu um erro ao conectar com o banco de dados Supabase.")
      } finally {
        setLoadingOptions(false)
      }
    }

    loadOptions()
  }, [])

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId)
  const selectedPpe = ppes.find(p => p.id === selectedPpeId)
  const selectedWorkplace = workplaces.find(w => w.id === selectedWorkplaceId)

  const isPpeExpired = selectedPpe ? new Date(selectedPpe.ca_expiry_date).getTime() < new Date().setHours(0, 0, 0, 0) : false

  const filteredPpes = ppes.filter(ppe => 
    ppe.name.toLowerCase().includes(ppeSearchTerm.toLowerCase()) || 
    ppe.ca_number.includes(ppeSearchTerm)
  )

  const handleEmployeeChange = (empId: string) => {
    setSelectedEmployeeId(empId)
    const emp = employees.find(e => e.id === empId)
    if (emp && emp.workplace_id) {
        setSelectedWorkplaceId(emp.workplace_id)
    } else {
        setSelectedWorkplaceId("")
    }
  }

  const clearSignature = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear()
    }
  }

  const generatePDFBlob = (signatureImageBase64: string): Blob => {
    const doc = new jsPDF()
    const dataFormatada = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
    const hash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

    doc.setFillColor(139, 26, 26) // #8B1A1A
    doc.rect(0, 0, 210, 30, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(22)
    doc.setFont("helvetica", "bold")
    doc.text("FICHA DE ENTREGA DE E.P.I.", 105, 18, { align: "center" })
    doc.setFontSize(10)
    doc.text("NR-06 - Ministério do Trabalho e Emprego", 105, 25, { align: "center" })

    doc.setTextColor(0, 0, 0)
    doc.setFontSize(12)
    doc.setFont("helvetica", "bold")
    doc.text("DADOS DO COLABORADOR E UNIDADE", 15, 42)
    doc.setFont("helvetica", "normal")
    doc.text(`Nome: ${selectedEmployee?.full_name}`, 15, 48)
    doc.text(`CPF: ${selectedEmployee?.cpf}`, 15, 53)
    doc.text(`Cargo: ${selectedEmployee?.job_title}`, 15, 58)
    doc.text(`Unidade/Canteiro: ${selectedWorkplace?.name || "Geral"}`, 15, 63)

    doc.setFont("helvetica", "bold")
    doc.text("DETALHES DO EQUIPAMENTO", 15, 75)
    doc.setFont("helvetica", "normal")
    doc.text(`Equipamento: ${selectedPpe?.name}`, 15, 81)
    doc.text(`Nº do C.A.: ${selectedPpe?.ca_number}`, 15, 86)
    doc.text(`Motivo da Entrega: ${reason}`, 15, 91)
    doc.text(`Data de Recebimento: ${dataFormatada}`, 15, 96)

    doc.line(15, 101, 195, 101)
    
    doc.setFont("helvetica", "bold")
    doc.text("TERMO DE RESPONSABILIDADE", 15, 110)
    doc.setFont("helvetica", "normal")
    const term = "Declaro ter recebido da empresa o(s) Equipamento(s) de Proteção Individual listado(s) acima. Comprometo-me a utilizá-lo(s) apenas para a finalidade a que se destina(m), responsabilizando-me por sua guarda e conservação. Estou ciente de que deverei comunicar ao SESMT qualquer acidente, dano ou extravio para a imediata substituição..."
    const splitTerm = doc.splitTextToSize(term, 180)
    doc.text(splitTerm, 15, 116)

    const ySignatureBox = 150
    doc.rect(15, ySignatureBox, 180, 50)
    doc.addImage(signatureImageBase64, 'PNG', 65, ySignatureBox + 5, 80, 25)
    doc.line(55, ySignatureBox + 35, 155, ySignatureBox + 35)
    doc.setFontSize(8)
    doc.text(`Assinatura (${authMethod === 'facial' ? 'Biometria Facial' : 'Manual'}): ${selectedEmployee?.full_name}`, 105, ySignatureBox + 40, { align: "center" })

    doc.setFontSize(7)
    doc.setTextColor(100)
    doc.text(`Token Antares: ${hash} | Unidade: ${selectedWorkplace?.name || "Sede"} | NR-06 Compliant`, 15, 215)

    return doc.output('blob')
  }

  const saveDelivery = async (signatureDataUrl: string) => {
    if (isPpeExpired) {
      alert("O EPI selecionado está com o CA vencido. A entrega não pode ser realizada.")
      return
    }

    try {
      setIsSaving(true)
      
      const response = await fetch(signatureDataUrl)
      const blob = await response.blob()
      const signatureFile = new File([blob], "signature.png", { type: "image/png" })

      await api.saveDelivery({
        employee_id: selectedEmployeeId,
        ppe_id: selectedPpeId,
        workplace_id: selectedWorkplaceId || null,
        reason: 'Primeira Entrega', // Default for new deliveries
        quantity: quantity,
        ip_address: `Terminal ${selectedWorkplace?.name || "Móvel"}`,
        signature_url: null
      }, signatureFile)

      const pdfBlob = generatePDFBlob(signatureDataUrl)
      setLastPdfUrl(URL.createObjectURL(pdfBlob))
      
      setIsSaved(true)
    } catch (err) {
      console.error("Erro ao finalizar entrega:", err)
      alert("Ocorreu um erro ao salvar no Supabase. Verifique se o bucket 'ppe_signatures' é público.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleManualSave = () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      alert("A assinatura é obrigatória.")
      return
    }
    const signatureDataUrl = sigCanvas.current.getTrimmedCanvas().toDataURL("image/png")
    saveDelivery(signatureDataUrl)
  }

  const handleFaceCapture = (descriptor: Float32Array, imageBase64: string) => {
    saveDelivery(imageBase64)
  }

  if (loadingOptions) {
      return (
          <div className="flex flex-col items-center justify-center py-40">
              <Loader2 className="w-10 h-10 animate-spin text-[#8B1A1A] mb-4" />
              <p className="font-bold text-slate-500 uppercase tracking-widest text-xs italic">Sincronizando Sessão Antares...</p>
          </div>
      )
  }

  if (isSaved) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[70vh] p-6 animate-in zoom-in duration-500 text-center">
        <div className="bg-red-50 p-4 rounded-full mb-6 text-[#8B1A1A]">
          <CheckCircle2 className="w-16 h-16" />
        </div>
        <h2 className="text-2xl font-black text-slate-800 mb-2 uppercase tracking-tighter italic">Comprovante Digital Gerado</h2>
        <p className="text-slate-500 max-w-md">A entrega para a unidade <strong>{selectedWorkplace?.name || "Sede"}</strong> foi validada e arquivada.</p>
        
        <div className="mt-8 flex flex-col sm:flex-row gap-4">
          {lastPdfUrl && (
            <a 
              href={lastPdfUrl}
              target="_blank"
              download="ficha_epi_antares.pdf"
              className="px-8 py-4 bg-[#8B1A1A] hover:bg-[#681313] text-white rounded-xl font-bold transition-all shadow-lg shadow-red-900/10 flex items-center justify-center border-b-4 border-red-900"
            >
              <FileDown className="w-5 h-5 mr-3" />
              Baixar Ficha NR-06
            </a>
          )}
          <button 
            onClick={() => { setIsSaved(false); setStep(1); setLastPdfUrl(null); }}
            className="px-8 py-4 bg-white hover:bg-slate-50 text-slate-600 rounded-xl font-bold transition-all border border-slate-200 shadow-sm"
          >
            Nova Entrega
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24 md:pb-8">
      <div className="mb-8 border-l-4 border-[#8B1A1A] pl-4">
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Terminal de Entregas (Entrada)</h1>
        <p className="text-slate-500 font-medium">Fornecimento de Novos Equipamentos.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl shadow-slate-200/50">
        <div className="flex bg-slate-50 border-b border-slate-100">
          <div className={`flex-1 text-center py-4 text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${step === 1 ? 'bg-white text-[#8B1A1A]' : 'text-slate-400'}`}>1. Seleção</div>
          <div className={`flex-1 text-center py-4 text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${step === 2 ? 'bg-white text-[#8B1A1A]' : 'text-slate-400'}`}>2. Autenticação</div>
        </div>

        <div className="p-8">
          {step === 1 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4">
              <div className="space-y-3">
                <label htmlFor="employee-select" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Colaborador Ativo</label>
                <select 
                  id="employee-select"
                  title="Selecionar colaborador"
                  aria-label="Selecionar colaborador para entrega de EPI"
                  className="w-full bg-slate-50 border-2 border-slate-100 text-slate-900 rounded-xl p-4 outline-none focus:border-[#8B1A1A] transition-all font-bold appearance-none"
                  value={selectedEmployeeId}
                  onChange={(e) => handleEmployeeChange(e.target.value)}
                >
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                  ))}
                  {employees.length === 0 && <option>Nenhum colaborador encontrado</option>}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label htmlFor="ppe-search" className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex justify-between">
                    <span>EPI Selecionado (C.A.)</span>
                    <span className="text-slate-300 font-medium normal-case tracking-normal">Busca Rápida</span>
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input 
                      id="ppe-search"
                      type="text"
                      placeholder="Pesquisar CA ou Nome..."
                      value={ppeSearchTerm}
                      onChange={(e) => setPpeSearchTerm(e.target.value)}
                      className="w-full sm:w-1/3 bg-white border-2 border-slate-100 text-slate-900 rounded-xl px-4 py-4 outline-none focus:border-[#8B1A1A] transition-all font-bold text-sm"
                    />
                    <select 
                      id="ppe-select"
                      title="Selecionar equipamento"
                      className="w-full sm:w-2/3 bg-slate-50 border-2 border-slate-100 text-slate-900 rounded-xl p-4 outline-none focus:border-[#8B1A1A] transition-all font-bold"
                      value={selectedPpeId}
                      onChange={(e) => setSelectedPpeId(e.target.value)}
                    >
                      <option value="">Selecione o EPI...</option>
                      {filteredPpes.map(ppe => {
                        const expired = new Date(ppe.ca_expiry_date).getTime() < new Date().setHours(0, 0, 0, 0)
                        return (
                          <option key={ppe.id} value={ppe.id} className={expired ? "text-red-600 font-bold" : ""}>
                            {expired ? "⚠️ [CA VENCIDO] " : ""}CA {ppe.ca_number} • {ppe.name}
                          </option>
                        )
                      })}
                      {filteredPpes.length === 0 && <option value="">Nenhum EPI encontrado</option>}
                    </select>
                  </div>
                  {isPpeExpired && (
                    <p className="text-red-600 text-[10px] font-black uppercase tracking-widest mt-1 flex items-center animate-pulse">
                       <ShieldAlert className="w-3 h-3 mr-1" />
                       Entrega Bloqueada: CA Vencido em {format(new Date(selectedPpe?.ca_expiry_date || ""), "dd/MM/yyyy")}
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <label htmlFor="quantity-input" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Quantidade</label>
                  <input 
                    id="quantity-input"
                    type="number"
                    min="1"
                    className="w-full bg-slate-50 border-2 border-slate-100 text-slate-900 rounded-xl p-4 outline-none focus:border-[#8B1A1A] transition-all font-bold"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="pt-4">
                <button 
                  disabled={employees.length === 0 || ppes.length === 0 || isPpeExpired}
                  onClick={() => setStep(2)}
                  className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white disabled:bg-slate-300 py-5 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-red-900/10 border-b-4 border-red-900 flex items-center justify-center gap-2"
                >
                  {isPpeExpired ? <ShieldAlert className="w-5 h-5" /> : null}
                  {isPpeExpired ? "EPI com CA Vencido" : "Avançar para Assinatura"}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="bg-slate-50 p-6 rounded-2xl text-sm border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                    <span className="bg-[#8B1A1A] text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest">NR-06</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">{selectedWorkplace?.name || "Sede Antares"}</span>
                </div>
                <p className="font-bold text-slate-700 italic">
                  &ldquo;Eu, <strong>{selectedEmployee?.full_name}</strong>, recebo nesta data o EPI <strong>{selectedPpe?.name}</strong> (CA {selectedPpe?.ca_number})...&rdquo;
                </p>
              </div>

              {/* Tabs de Assinatura */}
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button 
                  onClick={() => setAuthMethod('manual')}
                  className={`flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-all ${authMethod === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <PenLine className="w-4 h-4" /> Manual
                </button>
                <button 
                  onClick={() => setAuthMethod('facial')}
                  className={`flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 transition-all ${authMethod === 'facial' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Fingerprint className="w-4 h-4" /> Biometria
                </button>
              </div>

              {authMethod === 'manual' ? (
                <div className="space-y-3 animate-in fade-in">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Desenhe sua assinatura</label>
                    <button onClick={clearSignature} className="text-[10px] font-black text-[#8B1A1A] uppercase hover:underline italic">Limpar Painel</button>
                  </div>
                  <div className="bg-white rounded-3xl overflow-hidden border-2 border-slate-100 shadow-inner h-64 touch-none">
                    <SignatureCanvas 
                      ref={sigCanvas}
                      canvasProps={{ className: 'w-full h-full' }}
                      penColor="#000000"
                    />
                  </div>
                  <button 
                    disabled={isSaving || isPpeExpired}
                    onClick={handleManualSave}
                    className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white py-5 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-2xl shadow-red-900/20 flex items-center justify-center border-b-4 border-red-900 disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : "FINALIZAR ENTREGA DIGITAL"}
                  </button>
                </div>
              ) : (
                <div className="space-y-4 animate-in zoom-in-95">
                  {!selectedEmployee?.face_descriptor ? (
                    <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl text-center space-y-3">
                      <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto" />
                      <p className="text-amber-800 font-bold text-sm">Biometria não cadastrada</p>
                      <p className="text-amber-600 text-xs">O colaborador {selectedEmployee?.full_name} ainda não possui uma foto mestra. Volte à tela de Equipe e cadastre a biometria ou use a Assinatura Manual.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Validação Facial Ativa</span>
                        <div className="flex items-center gap-2">
                          <img src={selectedEmployee.photo_url || ''} alt="" className="w-6 h-6 rounded-full border border-slate-200 object-cover" />
                          <span className="text-[10px] font-bold text-slate-500">{selectedEmployee.full_name}</span>
                        </div>
                      </div>
                      <FaceCamera 
                        targetDescriptor={new Float32Array(selectedEmployee.face_descriptor)}
                        onCapture={handleFaceCapture}
                        onCancel={() => setAuthMethod('manual')}
                      />
                    </>
                  )}
                </div>
              )}

              <div className="pt-2 flex justify-center">
                <button onClick={() => setStep(1)} className="text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-slate-600">← Alterar Dados</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
