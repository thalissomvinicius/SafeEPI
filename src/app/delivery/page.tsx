"use client"

import { useState, useRef, useEffect } from "react"
import SignatureCanvas from "react-signature-canvas"
import { CheckCircle2, FileDown, Loader2 } from "lucide-react"
import jsPDF from "jspdf"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { api } from "@/services/api"
import { Employee, PPE } from "@/types/database"

export default function DeliveryPage() {
  const [step, setStep] = useState(1)
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  
  const [isSaved, setIsSaved] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Dados do banco
  const [employees, setEmployees] = useState<Employee[]>([])
  const [ppes, setPpes] = useState<PPE[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)

  // Estados dos formulários selecionados
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("")
  const [selectedPpeId, setSelectedPpeId] = useState("")
  const [reason, setReason] = useState("Primeira Entrega (Admissão)")

  useEffect(() => {
    async function loadOptions() {
      try {
        const [empData, ppeData] = await Promise.all([
          api.getEmployees(),
          api.getPpes()
        ])
        setEmployees(empData.filter(e => e.active))
        setPpes(ppeData.filter(p => p.active))
        
        if (empData.length > 0) setSelectedEmployeeId(empData[0].id)
        if (ppeData.length > 0) setSelectedPpeId(ppeData[0].id)
      } catch (err) {
        console.error("Erro ao carregar opções:", err)
      } finally {
        setLoadingOptions(false)
      }
    }
    loadOptions()
  }, [])

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId)
  const selectedPpe = ppes.find(p => p.id === selectedPpeId)

  const clearSignature = () => {
    sigCanvas.current?.clear()
  }

  const generatePDFBlob = (signatureImageBase64: string): Blob => {
    const doc = new jsPDF()
    const dataAtual = new Date()
    const dataFormatada = format(dataAtual, "dd 'de' MMMM 'de' yyyy, 'às' HH:mm", { locale: ptBR })
    const hash = Math.random().toString(36).substring(2, 15).toUpperCase()

    doc.setFontSize(16)
    doc.setFont("helvetica", "bold")
    doc.text("FICHA DE EQUIPAMENTO DE PROTEÇÃO INDIVIDUAL - EPI", 105, 20, { align: "center" })
    
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.text("Empresa: ANTARES EMPREENDIMENTOS S.A. | CNPJ: 12.345.678/0001-90", 15, 30)
    doc.setLineWidth(0.2)
    doc.line(15, 35, 195, 35)
    
    doc.setFont("helvetica", "bold")
    doc.text("DADOS DO COLABORADOR", 15, 42)
    doc.setFont("helvetica", "normal")
    doc.text(`Nome: ${selectedEmployee?.full_name}`, 15, 48)
    doc.text(`CPF: ${selectedEmployee?.cpf}`, 15, 53)
    doc.text(`Cargo: ${selectedEmployee?.job_title}`, 15, 58)

    doc.setFont("helvetica", "bold")
    doc.text("DETALHES DO EQUIPAMENTO", 15, 70)
    doc.setFont("helvetica", "normal")
    doc.text(`Equipamento: ${selectedPpe?.name}`, 15, 76)
    doc.text(`Nº do C.A.: ${selectedPpe?.ca_number}`, 15, 81)
    doc.text(`Motivo da Entrega: ${reason}`, 15, 86)
    doc.text(`Data de Recebimento: ${dataFormatada}`, 15, 91)

    doc.line(15, 96, 195, 96)
    
    doc.setFont("helvetica", "bold")
    doc.text("TERMO DE RESPONSABILIDADE", 15, 105)
    doc.setFont("helvetica", "normal")
    const term = "Declaro ter recebido da empresa o(s) Equipamento(s) de Proteção Individual listado(s) acima. Comprometo-me a utilizá-lo(s) apenas para a finalidade a que se destina(m), responsabilizando-me por sua guarda e conservação. Estou ciente de que deverei comunicar ao SESMT qualquer acidente, dano ou extravio para a imediata substituição..."
    const splitTerm = doc.splitTextToSize(term, 180)
    doc.text(splitTerm, 15, 111)

    const ySignatureBox = 145
    doc.rect(15, ySignatureBox, 180, 50)
    doc.addImage(signatureImageBase64, 'PNG', 65, ySignatureBox + 5, 80, 25)
    doc.line(55, ySignatureBox + 35, 155, ySignatureBox + 35)
    doc.setFontSize(8)
    doc.text(`Assinatura Digital: ${selectedEmployee?.full_name}`, 105, ySignatureBox + 40, { align: "center" })

    doc.setFontSize(7)
    doc.setTextColor(100)
    doc.text(`Token Antares: ${hash} | NR-06 Compliant`, 15, 210)

    return doc.output('blob')
  }

  const saveDelivery = async () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      alert("A assinatura é obrigatória.")
      return
    }

    try {
      setIsSaving(true)
      const signatureDataUrl = sigCanvas.current.getTrimmedCanvas().toDataURL("image/png")
      
      // Converter base64 para File/Blob para upload no Storage
      const response = await fetch(signatureDataUrl)
      const blob = await response.blob()
      const signatureFile = new File([blob], "signature.png", { type: "image/png" })

      // Salvar no Supabase (Storage + Tabela)
      await api.saveDelivery({
        employee_id: selectedEmployeeId,
        ppe_id: selectedPpeId,
        reason: reason as 'Primeira Entrega' | 'Substituição (Desgaste/Validade)' | 'Perda' | 'Dano',
        quantity: 1,
        ip_address: "Autenticado SESMT",
        signature_url: null // Será preenchido pelo serviço api.saveDelivery
      }, signatureFile)

      // Gerar PDF para visualização imediata
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

  if (loadingOptions) {
      return (
          <div className="flex flex-col items-center justify-center py-40">
              <Loader2 className="w-10 h-10 animate-spin text-[#8B1A1A] mb-4" />
              <p className="font-bold text-slate-500 uppercase tracking-widest text-xs">Sincronizando com Antares Supabase...</p>
          </div>
      )
  }

  if (isSaved) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[70vh] p-6 animate-in zoom-in duration-500 text-center">
        <div className="bg-red-50 p-4 rounded-full mb-6 text-[#8B1A1A]">
          <CheckCircle2 className="w-16 h-16" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2 italic uppercase tracking-tighter">Entrega Registrada com Sucesso!</h2>
        <p className="text-slate-500 max-w-md">Os dados foram persistidos no banco de dados e a assinatura foi salva no armazenamento seguro.</p>
        
        <div className="mt-8 flex flex-col sm:flex-row gap-4">
          {lastPdfUrl && (
            <a 
              href={lastPdfUrl}
              target="_blank"
              download="ficha_epi_antares.pdf"
              className="px-8 py-4 bg-[#8B1A1A] hover:bg-[#681313] text-white rounded-xl font-bold transition-all shadow-lg shadow-red-900/10 flex items-center justify-center transform hover:scale-105"
            >
              <FileDown className="w-5 h-5 mr-3" />
              Ver Comprovante PDF
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
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Terminal SESMT Antares</h1>
        <p className="text-slate-500 font-medium">Autenticação NR-06 via Nuvem.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl shadow-slate-200/50">
        <div className="flex bg-slate-50">
          <div className={`flex-1 text-center py-4 text-xs font-black uppercase tracking-widest border-b-4 transition-all duration-300 ${step === 1 ? 'border-[#8B1A1A] text-[#8B1A1A]' : 'border-transparent text-slate-400'}`}>1. Seleção</div>
          <div className={`flex-1 text-center py-4 text-xs font-black uppercase tracking-widest border-b-4 transition-all duration-300 ${step === 2 ? 'border-[#8B1A1A] text-[#8B1A1A]' : 'border-transparent text-slate-400'}`}>2. Validação</div>
        </div>

        <div className="p-8">
          {step === 1 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4">
              <div className="space-y-3">
                <label htmlFor="employee-select" className="text-xs font-black text-slate-400 uppercase tracking-widest">Colaborador Antares</label>
                <select 
                  id="employee-select"
                  className="w-full bg-slate-50 border-2 border-slate-100 text-slate-900 rounded-xl p-4 outline-none focus:border-[#8B1A1A] transition-all font-bold"
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                >
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.full_name} • {emp.job_title}</option>
                  ))}
                  {employees.length === 0 && <option>Nenhum colaborador ativo encontrado</option>}
                </select>
              </div>

              <div className="space-y-3">
                <label htmlFor="ppe-select" className="text-xs font-black text-slate-400 uppercase tracking-widest">Equipamento (C.A. Ativo)</label>
                <select 
                  id="ppe-select"
                  className="w-full bg-slate-50 border-2 border-slate-100 text-slate-900 rounded-xl p-4 outline-none focus:border-[#8B1A1A] transition-all font-bold"
                  value={selectedPpeId}
                  onChange={(e) => setSelectedPpeId(e.target.value)}
                >
                  {ppes.map(ppe => (
                    <option key={ppe.id} value={ppe.id}>CA {ppe.ca_number} • {ppe.name}</option>
                  ))}
                  {ppes.length === 0 && <option>Nenhum EPI encontrado</option>}
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="reason-select" className="text-xs font-black text-slate-400 uppercase tracking-widest">Motivo</label>
                <select 
                  id="reason-select"
                  className="w-full bg-slate-50 border-2 border-slate-100 text-slate-900 rounded-xl p-4 outline-none focus:border-[#8B1A1A] transition-all font-bold"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                   <option>Primeira Entrega (Admissão)</option>
                   <option>Substituição (Desgaste/Validade)</option>
                   <option>Perda</option>
                   <option>Dano</option>
                </select>
              </div>

              <div className="pt-4">
                <button 
                  disabled={employees.length === 0 || ppes.length === 0}
                  onClick={() => setStep(2)}
                  className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white disabled:bg-slate-300 py-4 rounded-xl font-black uppercase tracking-widest transition-all"
                >
                  Ir para Assinatura
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
              <div className="bg-slate-50 p-6 rounded-2xl text-sm border border-slate-200">
                <p className="font-black text-[#8B1A1A] uppercase tracking-tighter mb-2 italic underline">TERMO DE RECEBIMENTO</p>
                <p className="text-slate-600">
                  &ldquo;Eu, <strong>{selectedEmployee?.full_name}</strong>, recebo nesta data o EPI <strong>{selectedPpe?.name}</strong> (CA {selectedPpe?.ca_number}).&rdquo;
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Assinatura do Colaborador</label>
                  <button onClick={clearSignature} className="text-[10px] font-black text-[#8B1A1A] uppercase hover:underline">Limpar</button>
                </div>
                <div className="bg-white rounded-2xl overflow-hidden border-2 border-slate-100 shadow-inner h-60 touch-none">
                  <SignatureCanvas 
                    ref={sigCanvas}
                    canvasProps={{ className: 'w-full h-full' }}
                    penColor="#000000"
                  />
                </div>
              </div>

              <div className="pt-2 flex flex-col gap-4">
                <button 
                  disabled={isSaving}
                  onClick={saveDelivery}
                  className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white py-5 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-red-900/20 flex items-center justify-center"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : "AUTENTICAR E SALVAR"}
                </button>
                <button onClick={() => setStep(1)} className="text-slate-400 font-bold text-xs uppercase tracking-widest">← Voltar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
