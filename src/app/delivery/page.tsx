"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Image from "next/image"
import SignatureCanvas from "react-signature-canvas"
import { CheckCircle2, FileDown, Loader2, ShieldAlert, Fingerprint, PenLine, Link2, Plus, Trash2, Package, Calendar, Clock } from "lucide-react"
import { format, addDays } from "date-fns"
import { api } from "@/services/api"
import { Employee, PPE, Workplace, Delivery } from "@/types/database"
import { FaceCamera } from "@/components/ui/FaceCamera"
import { generateDeliveryPDF } from "@/utils/pdfGenerator"
import { COMPANY_CONFIG } from "@/config/company"
import { formatCpf } from "@/utils/cpf"
import { toast } from "sonner"

interface CartItem {
  ppeId: string
  ppeName: string
  ppeCaNumber: string
  ppeCaExpiry: string
  quantity: number
  reason: string
}

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
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState("")
  const [ppeSearchTerm, setPpeSearchTerm] = useState("")
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState("")
  const [deliveryDate, setDeliveryDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))

  // ── CART: Multi-EPI ──
  const [cart, setCart] = useState<CartItem[]>([])
  const [currentPpeId, setCurrentPpeId] = useState("")
  const [currentQuantity, setCurrentQuantity] = useState(1)
  const [currentReason, setCurrentReason] = useState("Primeira Entrega")

  // Biometria Facial
  const [authMethod, setAuthMethod] = useState<'manual' | 'facial'>('manual')

  useEffect(() => {
    const captureMetadata = async () => {
        try {
            const ipRes = await fetch('https://api.ipify.org?format=json')
            const ipData = await ipRes.json()
            setIpAddress(ipData.ip)

            if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    setLocation(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`)
                  },
                  (err) => {
                    console.warn("Geolocation denied or unavailable:", err.message)
                    setLocation("Permissão negada pelo dispositivo")
                  },
                  { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                )
            } else {
                setLocation("Navegador sem suporte a GPS")
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
        if (ppeData.length > 0) setCurrentPpeId(ppeData[0].id)
      } catch (error) {
        console.error("Erro ao carregar opções:", error)
      } finally {
        setLoadingOptions(false)
      }
    }

    loadOptions()
  }, [])

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId)
  const currentPpe = ppes.find(p => p.id === currentPpeId)
  const selectedWorkplace = workplaces.find(w => w.id === selectedWorkplaceId)

  const isCurrentPpeExpired = currentPpe ? new Date(currentPpe.ca_expiry_date).getTime() < new Date().setHours(0, 0, 0, 0) : false

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

  // ── Cart operations ──
  const addToCart = () => {
    if (!currentPpe) return
    if (isCurrentPpeExpired) {
      toast.error("EPI com CA vencido não pode ser entregue.")
      return
    }
    
    // Verificação de Estoque
    const totalInCart = cart.reduce((acc, item) => item.ppeId === currentPpeId ? acc + item.quantity : acc, 0)
    if (totalInCart + currentQuantity > currentPpe.current_stock) {
      toast.error(`Estoque Insuficiente! Você possui apenas ${currentPpe.current_stock} unidades de ${currentPpe.name} no estoque. Por favor, adicione mais estoque primeiro.`)
      return
    }

    if (cart.some(item => item.ppeId === currentPpeId)) {
      toast.error("Este EPI já está na lista. Remova-o se quiser alterar a quantidade.")
      return
    }

    setCart(prev => [...prev, {
      ppeId: currentPpeId,
      ppeName: currentPpe.name,
      ppeCaNumber: currentPpe.ca_number,
      ppeCaExpiry: currentPpe.ca_expiry_date,
      quantity: currentQuantity,
      reason: currentReason
    }])
    setCurrentQuantity(1)
    setPpeSearchTerm("")
    toast.success(`${currentPpe.name} adicionado à entrega.`)
  }

  const removeFromCart = (ppeId: string) => {
    setCart(prev => prev.filter(item => item.ppeId !== ppeId))
  }

  const clearSignature = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear()
    }
  }

  const saveDelivery = useCallback(async (signatureDataUrl: string) => {
    if (cart.length === 0) {
      toast.error("Adicione pelo menos um EPI à lista de entrega.")
      return
    }

    try {
      setIsSaving(true)
      
      const payload = `${selectedEmployeeId}-${Date.now()}`
      const validationHash = btoa(payload).substring(0, 12).toUpperCase()
      
      const response = await fetch(signatureDataUrl)
      const blob = await response.blob()
      const signatureFile = new File([blob], "signature.png", { type: "image/png" })

      // Save each item as a separate delivery record (same signature)
      for (const item of cart) {
        await api.saveDelivery({
          employee_id: selectedEmployeeId,
          ppe_id: item.ppeId,
          workplace_id: selectedWorkplaceId || null,
          reason: item.reason as Delivery['reason'],
          quantity: item.quantity,
          ip_address: ipAddress || "Desconhecido",
          auth_method: authMethod,
          signature_url: null,
          delivery_date: new Date(deliveryDate).toISOString()
        }, signatureFile)
      }

      // Generate ONE PDF with all items
      const pdfBlob = await generateDeliveryPDF({
        employeeName: selectedEmployee?.full_name || "",
        employeeCpf: selectedEmployee?.cpf || "",
        employeeRole: selectedEmployee?.job_title || "",
        workplaceName: selectedWorkplace?.name || "Sede",
        ppeName: cart[0].ppeName,
        ppeCaNumber: cart[0].ppeCaNumber,
        ppeCaExpiry: cart[0].ppeCaExpiry,
        quantity: cart[0].quantity,
        reason: cart[0].reason,
        items: cart.map(item => ({
          ppeName: item.ppeName,
          ppeCaNumber: item.ppeCaNumber,
          caExpiry: item.ppeCaExpiry,
          quantity: item.quantity,
          reason: item.reason
        })),
        authMethod,
        signatureBase64: signatureDataUrl,
        ipAddress,
        location,
        validationHash,
        deliveryDate: new Date(deliveryDate).toISOString()
      })
      
      const shortId = validationHash.slice(0, 8)
      const safeName = (selectedEmployee?.full_name || "Comprovante").split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const itemCount = cart.length > 1 ? `${cart.length}EPIs` : cart[0].ppeName.split(' ')[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const fileName = `Comprovante_${shortId}_${safeName}_${itemCount}.pdf`
      
      const pdfUrl = URL.createObjectURL(pdfBlob)
      setLastPdfUrl(pdfUrl)
      setIsSaved(true)

      const link = document.createElement('a')
      link.href = pdfUrl
      link.setAttribute('download', fileName)
      document.body.appendChild(link)
      link.click()
      link.remove()

      toast.success(`Entrega de ${cart.length} EPI(s) registrada com sucesso!`)
    } catch (err) {
      console.error("Erro ao finalizar entrega:", err)
      toast.error("Erro ao salvar entrega.")
    } finally {
      setIsSaving(false)
    }
  }, [selectedEmployeeId, selectedWorkplaceId, cart, ipAddress, location, authMethod, selectedEmployee, selectedWorkplace, deliveryDate])

  const handleManualSave = () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      toast.error("A assinatura é obrigatória.")
      return
    }
    const signatureDataUrl = sigCanvas.current.getTrimmedCanvas().toDataURL("image/png")
    saveDelivery(signatureDataUrl)
  }

  const handleFaceCapture = (descriptor: Float32Array, imageBase64: string) => {
    saveDelivery(imageBase64)
  }

  const generateRemoteLink = async () => {
      if (cart.length === 0) {
        toast.error("Adicione pelo menos um EPI à lista antes de gerar o link.")
        return
      }
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
      const deliveryDataPayload = {
          e: selectedEmployeeId,
          p: cart[0].ppeId,
          w: selectedWorkplaceId,
          q: cart[0].quantity,
          r: cart[0].reason
      }

      try {
        const data = await api.createRemoteLink({
          employee_id: selectedEmployeeId,
          type: 'delivery',
          data: deliveryDataPayload
        })
        const url = `${baseUrl}/delivery/remote?t=${data.link.token}`
        navigator.clipboard.writeText(url)
        toast.success("Link de assinatura remota copiado! Válido por 24h.");
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
        toast.error(`Erro ao gerar link: ${errorMsg}.`);
      }
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
        <p className="text-slate-500 max-w-md italic text-sm">{cart.length} EPI(s) registrado(s) • IP {ipAddress || '...'}</p>
        
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
            onClick={() => { setIsSaved(false); setStep(1); setLastPdfUrl(null); setCart([]); }}
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
              {/* Data da Entrega */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#8B1A1A]" />
                    Data da Entrega
                  </h3>
                  <p className="text-[10px] font-medium text-slate-500 italic mt-0.5">Selecione para entregas retroativas.</p>
                </div>
                <input 
                  type="date"
                  title="Data da Entrega"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-full sm:w-auto bg-white border border-slate-200 text-slate-900 rounded-xl px-4 py-2 outline-none focus:border-[#8B1A1A] font-bold text-sm shadow-sm"
                />
              </div>

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
                                      CPF: {formatCpf(emp.cpf)}
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

              {/* ── UNIDADE / LOCAL ── */}
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <span>Unidade / Local de Entrega</span>
                  {selectedWorkplace && (
                    <span className="text-[9px] bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded font-black uppercase tracking-widest">
                      Auto-preenchido
                    </span>
                  )}
                </label>
                <select
                  title="Unidade / Local de Entrega"
                  value={selectedWorkplaceId}
                  onChange={(e) => setSelectedWorkplaceId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-5 py-4 outline-none focus:border-[#8B1A1A] focus:bg-white transition-all font-bold text-sm appearance-none cursor-pointer"
                >
                  <option value="">— Nenhuma Unidade / Sede —</option>
                  {workplaces.map(wp => (
                    <option key={wp.id} value={wp.id}>{wp.name}</option>
                  ))}
                </select>
              </div>
              {/* ── ADICIONAR EPI AO CARRINHO ── */}
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Adicionar EPI à Entrega</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <input 
                      type="text"
                      placeholder="Busca por CA ou Nome..."
                      value={ppeSearchTerm}
                      onChange={(e) => setPpeSearchTerm(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-5 py-3 outline-none focus:border-[#8B1A1A] focus:bg-white transition-all font-bold text-sm"
                    />
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                      <div className="max-h-40 overflow-y-auto divide-y divide-slate-50">
                        {filteredPpes.length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">Nenhum EPI encontrado</div>
                        ) : (
                          filteredPpes.map(ppe => {
                            const expired = new Date(ppe.ca_expiry_date).getTime() < new Date().setHours(0, 0, 0, 0)
                            const isSelected = currentPpeId === ppe.id
                            const inCart = cart.some(item => item.ppeId === ppe.id)
                            return (
                              <div 
                                key={ppe.id}
                                onClick={() => !inCart && setCurrentPpeId(ppe.id)}
                                className={`p-3 cursor-pointer transition-colors flex items-center justify-between ${inCart ? 'opacity-40 cursor-not-allowed' : isSelected ? 'bg-red-50/50 border-l-4 border-[#8B1A1A]' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}
                              >
                                <div>
                                  <p className={`font-black text-xs uppercase tracking-tight ${isSelected ? 'text-[#8B1A1A]' : 'text-slate-700'}`}>{ppe.name}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">CA {ppe.ca_number}</span>
                                    {expired && <span className="text-[8px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Vencido</span>}
                                    {inCart && <span className="text-[8px] font-black bg-green-100 text-green-600 px-1.5 py-0.5 rounded">Na lista</span>}
                                  </div>
                                </div>
                                {isSelected && !inCart && <CheckCircle2 className="w-4 h-4 text-[#8B1A1A]" />}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label htmlFor="quantity-input" className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Quantidade</label>
                      <input 
                        id="quantity-input"
                        type="number" min="1" max="100"
                        title="Quantidade do EPI"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl px-4 py-3 outline-none focus:border-[#8B1A1A] focus:bg-white transition-all font-bold text-sm"
                        value={currentQuantity}
                        onChange={(e) => setCurrentQuantity(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                      />
                    </div>
                    <div>
                      <label htmlFor="reason-select" className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Motivo</label>
                      <select
                        id="reason-select"
                        title="Motivo da entrega"
                        value={currentReason}
                        onChange={(e) => setCurrentReason(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl px-4 py-3 outline-none focus:border-[#8B1A1A] font-bold text-xs"
                      >
                        <option value="Primeira Entrega">Primeira Entrega</option>
                        <option value="Substituição (Desgaste/Validade)">Substituição</option>
                        <option value="Perda">Perda</option>
                        <option value="Dano">Dano</option>
                      </select>
                    </div>

                    {currentPpe && currentPpe.lifespan_days > 0 && (
                      <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black text-orange-600 uppercase tracking-widest">Vida Útil (NR-06)</span>
                          <span className="text-xs font-bold text-orange-800">{currentPpe.lifespan_days} dias</span>
                        </div>
                        <div className="flex items-center justify-between mt-1 pt-2 border-t border-orange-200">
                          <span className="text-[9px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Próxima Troca
                          </span>
                          <span className="text-xs font-black text-[#8B1A1A]">
                            {format(addDays(new Date(`${deliveryDate}T12:00:00`), currentPpe.lifespan_days), 'dd/MM/yyyy')}
                          </span>
                        </div>
                      </div>
                    )}
                    <button 
                      onClick={addToCart}
                      disabled={!currentPpe || isCurrentPpeExpired}
                      className="w-full bg-slate-800 hover:bg-slate-900 text-white disabled:bg-slate-300 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> Adicionar à Entrega
                    </button>
                  </div>
                </div>
              </div>

              {/* ── CARRINHO (Lista de EPIs) ── */}
              {cart.length > 0 && (
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    EPIs para Entrega ({cart.length})
                  </label>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl divide-y divide-slate-200 overflow-hidden">
                    {cart.map((item) => (
                      <div key={item.ppeId} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-black text-sm text-slate-800 uppercase tracking-tight">{item.ppeName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] font-bold bg-white text-slate-500 px-2 py-0.5 rounded border border-slate-200">CA {item.ppeCaNumber}</span>
                            <span className="text-[9px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Qtd: {item.quantity}</span>
                            <span className="text-[9px] font-bold text-slate-400">{item.reason}</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => removeFromCart(item.ppeId)} 
                          title="Remover EPI"
                          aria-label={`Remover ${item.ppeName}`}
                          className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 space-y-3">
                <button 
                  disabled={employees.length === 0 || cart.length === 0}
                  onClick={() => setStep(2)}
                  className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white disabled:bg-slate-300 py-5 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-red-900/10 border-b-4 border-red-900 flex items-center justify-center gap-2"
                >
                  Avançar para Assinatura ({cart.length} EPI{cart.length !== 1 ? 's' : ''})
                </button>
                <div className="flex items-center gap-2 text-slate-400">
                    <div className="flex-1 h-[1px] bg-slate-100" />
                    <span className="text-[8px] font-black uppercase tracking-widest">Ou</span>
                    <div className="flex-1 h-[1px] bg-slate-100" />
                </div>
                <button 
                  onClick={generateRemoteLink}
                  disabled={cart.length === 0}
                  className="w-full bg-white border border-slate-200 text-slate-600 py-3 rounded-xl font-bold uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-slate-50 transition-all disabled:opacity-40"
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
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">{selectedWorkplace?.name || "Sede"}</span>
                </div>
                <p className="font-bold text-slate-700 italic">
                  &ldquo;Eu, <strong>{selectedEmployee?.full_name}</strong>, recebo nesta data {cart.length} EPI(s):&rdquo;
                </p>
                <ul className="mt-2 space-y-1">
                  {cart.map(item => (
                    <li key={item.ppeId} className="text-xs text-slate-600 font-medium flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-[#8B1A1A] rounded-full flex-shrink-0" />
                      {item.ppeName} (CA {item.ppeCaNumber}) — Qtd: {item.quantity}
                    </li>
                  ))}
                </ul>
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
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : `FINALIZAR ENTREGA (${cart.length} EPI${cart.length !== 1 ? 'S' : ''})`}
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
