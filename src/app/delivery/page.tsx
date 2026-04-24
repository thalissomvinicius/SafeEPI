"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Image from "next/image"
import SignatureCanvas from "react-signature-canvas"
import { CheckCircle2, FileDown, Loader2, ShieldAlert, Fingerprint, PenLine, Link2 } from "lucide-react"
import { api } from "@/services/api"
import { Employee, PPE, Workplace } from "@/types/database"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { generateDeliveryPDF } from "@/utils/pdfGenerator"
import { COMPANY_CONFIG } from "@/config/company"

export default function DeliveryPage() {
  const [step, setStep] = useState(1)
  const sigCanvas = useRef<SignatureCanvas | null>(null)
  
  const [isSaved, setIsSaved] = useState(false)
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Metadados de Autenticidade
  const [ipAddress, setIpAddress] = useState<string>("")
  const [location, setLocation] = useState<string>("")

  // Dados do banco
  const [employees, setEmployees] = useState<Employee[]>([])
  const [ppes, setPpes] = useState<PPE[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)

  // Estados dos formulários selecionados
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("")
  const [selectedPpeId, setSelectedPpeId] = useState("")
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState("")
  const [ppeSearchTerm, setPpeSearchTerm] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState("")
  const [reason, setReason] = useState("Primeira Entrega")

  // Biometria Facial
  const [authMethod, setAuthMethod] = useState<'manual' | 'facial'>('manual')

  useEffect(() => {
    // Captura IP e Localização ao carregar
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
        } catch (e) { console.error("Erro ao capturar metadados:", e) }
    }
    captureMetadata()

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

  const filteredEmployees = employees.filter(emp => 
    emp.full_name.toLowerCase().includes(employeeSearchTerm.toLowerCase()) || 
    (emp.cpf && emp.cpf.includes(employeeSearchTerm))
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

  const saveDelivery = useCallback(async (signatureDataUrl: string) => {
    if (isPpeExpired) {
      alert("O EPI selecionado está com o CA vencido.")
      return
    }

    try {
      setIsSaving(true)
      
      // Geração de Hash de Validação
      const payload = `${selectedEmployeeId}-${selectedPpeId}-${Date.now()}`
      const validationHash = btoa(payload).substring(0, 12).toUpperCase()
      
      const response = await fetch(signatureDataUrl)
      const blob = await response.blob()
      const signatureFile = new File([blob], "signature.png", { type: "image/png" })

      await api.saveDelivery({
        employee_id: selectedEmployeeId,
        ppe_id: selectedPpeId,
        workplace_id: selectedWorkplaceId || null,
        reason: 'Primeira Entrega',
        quantity: quantity,
        ip_address: ipAddress || "Desconhecido",
        signature_url: null
      }, signatureFile)

      const pdfBlob = await generateDeliveryPDF({
        employeeName: selectedEmployee?.full_name || "",
        employeeCpf: selectedEmployee?.cpf || "",
        employeeRole: selectedEmployee?.job_title || "",
        workplaceName: selectedWorkplace?.name || "Sede",
        ppeName: selectedPpe?.name || "",
        ppeCaNumber: selectedPpe?.ca_number || "",
        quantity,
        reason,
        authMethod,
        signatureBase64: signatureDataUrl,
        ipAddress,
        location,
        validationHash
      })
      setLastPdfUrl(URL.createObjectURL(pdfBlob))
      setIsSaved(true)
    } catch (err) {
      console.error("Erro ao finalizar entrega:", err)
      alert("Erro ao salvar entrega.")
    } finally {
      setIsSaving(false)
    }
  }, [selectedEmployeeId, selectedPpeId, selectedWorkplaceId, quantity, ipAddress, location, isPpeExpired, authMethod, selectedEmployee, selectedPpe, selectedWorkplace, reason])

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

  const generateRemoteLink = () => {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
      const data = {
          e: selectedEmployeeId,
          p: selectedPpeId,
          w: selectedWorkplaceId,
          q: quantity,
          r: reason
      }
      const encoded = btoa(JSON.stringify(data))
      const url = `${baseUrl}/delivery/remote?s=${encoded}`
      navigator.clipboard.writeText(url)
      alert("Link de assinatura remota copiado para o clipboard! Envie para o colaborador.")
  }

  if (loadingOptions) {
      return (
          <div className="flex flex-col items-center justify-center py-40">
              <Loader2 className="w-10 h-10 animate-spin text-[#8B1A1A] mb-4" />
              <p className="font-bold text-slate-500 uppercase tracking-widest text-xs italic">Sincronizando Sessão {COMPANY_CONFIG.shortName}...</p>
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
        <p className="text-slate-500 max-w-md italic text-sm">Validado em IP {ipAddress || '...'} com Hash Único de Segurança.</p>
        
        <div className="mt-8 flex flex-col sm:flex-row gap-4">
          {lastPdfUrl && (
            <a 
              href={lastPdfUrl}
              target="_blank"
              download={`ficha_epi_${COMPANY_CONFIG.shortName.toLowerCase()}.pdf`}
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
        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Terminal de Entregas Digital {COMPANY_CONFIG.shortName}</h1>
        <p className="text-slate-500 font-medium">Compliance NR-06 com Rastreabilidade de Autoria.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl shadow-slate-200/50">
        <div className="flex bg-slate-50 border-b border-slate-100">
          <div className={`flex-1 text-center py-4 text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${step === 1 ? 'bg-white text-[#8B1A1A]' : 'text-slate-400'}`}>1. Seleção</div>
          <div className={`flex-1 text-center py-4 text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${step === 2 ? 'bg-white text-[#8B1A1A]' : 'text-slate-400'}`}>2. Autenticação</div>
        </div>

        <div className="p-5 sm:p-8">
          {step === 1 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4">
              <div className="space-y-3">
                <label htmlFor="employee-select" className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex justify-between">
                  <span>Colaborador Ativo</span>
                </label>
                <div className="flex flex-col gap-3 relative">
                  <input 
                    type="text"
                    placeholder="Busca por nome ou CPF..."
                    value={employeeSearchTerm}
                    onChange={(e) => setEmployeeSearchTerm(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-5 py-4 outline-none focus:border-[#8B1A1A] focus:bg-white transition-all font-bold text-sm"
                  />
                  
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-50">
                      {filteredEmployees.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">Nenhum colaborador encontrado</div>
                      ) : (
                        filteredEmployees.map(emp => {
                          const isSelected = selectedEmployeeId === emp.id
                          
                          return (
                            <div 
                              key={emp.id}
                              onClick={() => handleEmployeeChange(emp.id)}
                              className={`p-4 cursor-pointer transition-colors flex items-center justify-between ${isSelected ? 'bg-red-50/50 border-l-4 border-[#8B1A1A]' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}
                            >
                              <div>
                                <p className={`font-black text-sm uppercase tracking-tight ${isSelected ? 'text-[#8B1A1A]' : 'text-slate-700'}`}>
                                  {emp.full_name}
                                </p>
                                {emp.cpf && (
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase tracking-widest">
                                      CPF: {emp.cpf}
                                    </span>
                                  </div>
                                )}
                              </div>
                              {isSelected && <CheckCircle2 className="w-5 h-5 text-[#8B1A1A]" />}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label htmlFor="ppe-select" className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex justify-between">
                    <span>EPI Selecionado (C.A.)</span>
                  </label>
                  <div className="flex flex-col gap-3 relative">
                    <input 
                      type="text"
                      placeholder="Busca por CA ou Nome..."
                      value={ppeSearchTerm}
                      onChange={(e) => setPpeSearchTerm(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-5 py-4 outline-none focus:border-[#8B1A1A] focus:bg-white transition-all font-bold text-sm"
                    />
                    
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                      <div className="max-h-48 overflow-y-auto divide-y divide-slate-50">
                        {filteredPpes.length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">Nenhum EPI encontrado</div>
                        ) : (
                          filteredPpes.map(ppe => {
                            const expired = new Date(ppe.ca_expiry_date).getTime() < new Date().setHours(0, 0, 0, 0)
                            const isSelected = selectedPpeId === ppe.id
                            
                            return (
                              <div 
                                key={ppe.id}
                                onClick={() => setSelectedPpeId(ppe.id)}
                                className={`p-4 cursor-pointer transition-colors flex items-center justify-between ${isSelected ? 'bg-red-50/50 border-l-4 border-[#8B1A1A]' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}
                              >
                                <div>
                                  <p className={`font-black text-sm uppercase tracking-tight ${isSelected ? 'text-[#8B1A1A]' : 'text-slate-700'}`}>
                                    {ppe.name}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase tracking-widest">
                                      CA {ppe.ca_number}
                                    </span>
                                    {expired && (
                                      <span className="text-[8px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded uppercase tracking-widest">
                                        Vencido
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {isSelected && <CheckCircle2 className="w-5 h-5 text-[#8B1A1A]" />}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label htmlFor="quantity-input" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Quantidade</label>
                  <input 
                    id="quantity-input"
                    type="number"
                    min="1"
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-5 py-4 outline-none focus:border-[#8B1A1A] focus:bg-white transition-all font-bold text-sm"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-3 sm:col-span-2">
                  <label htmlFor="reason-select" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Motivo da Entrega</label>
                  <div className="grid grid-cols-2 gap-3">
                    {['Primeira Entrega', 'Substituição (Desgaste/Validade)', 'Perda', 'Dano'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setReason(opt)}
                        className={`p-4 rounded-2xl border text-xs font-black uppercase tracking-tight transition-all flex items-center justify-center text-center ${reason === opt ? 'border-[#8B1A1A] bg-red-50 text-[#8B1A1A] shadow-md shadow-red-900/10' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-4 space-y-3">
                <button 
                  disabled={employees.length === 0 || ppes.length === 0 || isPpeExpired}
                  onClick={() => setStep(2)}
                  className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white disabled:bg-slate-300 py-5 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-red-900/10 border-b-4 border-red-900 flex items-center justify-center gap-2"
                >
                  Avançar para Assinatura
                </button>
                <div className="flex items-center gap-2 text-slate-400">
                    <div className="flex-1 h-[1px] bg-slate-100" />
                    <span className="text-[8px] font-black uppercase tracking-widest">Ou</span>
                    <div className="flex-1 h-[1px] bg-slate-100" />
                </div>
                <button 
                  onClick={generateRemoteLink}
                  className="w-full bg-white border border-slate-200 text-slate-600 py-3 rounded-xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-slate-50 transition-all"
                >
                  <Link2 className="w-4 h-4 text-blue-500" /> Gerar Link de Assinatura Remota
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="bg-slate-50 p-6 rounded-2xl text-sm border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                    <span className="bg-[#8B1A1A] text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest">NR-06 Compliance</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">{selectedWorkplace?.name || "Sede Antares"}</span>
                </div>
                <p className="font-bold text-slate-700 italic">
                  &ldquo;Eu, <strong>{selectedEmployee?.full_name}</strong>, recebo nesta data o EPI <strong>{selectedPpe?.name}</strong> (CA {selectedPpe?.ca_number})...&rdquo;
                </p>
              </div>

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
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Assinatura Manuscrita</label>
                    <button onClick={clearSignature} className="text-[10px] font-black text-[#8B1A1A] uppercase hover:underline italic">Limpar</button>
                  </div>
                  <div className="bg-white rounded-3xl overflow-hidden border-2 border-slate-100 shadow-inner h-64 touch-none">
                    <SignatureCanvas 
                      ref={sigCanvas}
                      canvasProps={{ className: 'w-full h-full' }}
                      penColor="#000000"
                    />
                  </div>
                  <button 
                    disabled={isSaving}
                    onClick={handleManualSave}
                    className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white py-5 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-2xl shadow-red-900/20 flex items-center justify-center border-b-4 border-red-900 disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : "FINALIZAR ENTREGA"}
                  </button>
                </div>
              ) : (
                <div className="space-y-4 animate-in zoom-in-95">
                  {!selectedEmployee?.face_descriptor ? (
                    <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl text-center space-y-3">
                      <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto" />
                      <p className="text-amber-800 font-bold text-sm">Biometria não cadastrada</p>
                      <p className="text-amber-600 text-xs">O colaborador {selectedEmployee?.full_name} ainda não possui uma foto mestra.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Identidade Certificada</span>
                        <div className="flex items-center gap-2">
                          <Image src={selectedEmployee.photo_url || ''} alt="User" width={24} height={24} className="w-6 h-6 rounded-full border border-slate-200 object-cover" unoptimized />
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

