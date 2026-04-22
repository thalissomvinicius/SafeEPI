"use client"

import { useState, useEffect, useCallback } from "react"
import { Users, Plus, Search, X, Loader2, HardDrive, FileDown, ShieldAlert, History, UserMinus, ShieldCheck, Lock } from "lucide-react"
import { api } from "@/services/api"
import { Employee, Workplace, DeliveryWithRelations } from "@/types/database"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { useAuth } from "@/contexts/AuthContext"
import { Skeleton } from "@/components/ui/Skeleton"

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // Prontuario State
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [employeeHistory, setEmployeeHistory] = useState<DeliveryWithRelations[]>([])
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  
  // Form State
  const [formData, setFormData] = useState({ 

    name: "", 
    role: "", 
    department: "", 
    cpf: "",
    workplace_id: "" 
  })
  const [isSaving, setIsSaving] = useState(false)
  const { user } = useAuth()
  const canEdit = user?.role === 'ADMIN'

  // Fetch real data from Supabase
  const loadData = async () => {
    try {
      // Removed synchronous setLoading(true) to avoid cascading renders in useEffect.
      // Loading is initialized to true.
      const [empData, wpData] = await Promise.all([
        api.getEmployees(),
        api.getWorkplaces()
      ])
      setEmployees(empData)
      setWorkplaces(wpData)
    } catch (error) {
      console.error("Erro ao carregar dados:", error)
      alert("Falha ao carregar dados do banco de dados.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Initial load - wrapped in setTimeout to ensure it's asynchronous and avoid cascading render warnings
    const timer = setTimeout(() => {
      loadData()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  const filteredEmployees = employees.filter(emp => 
    emp.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    emp.cpf.includes(searchTerm)
  )

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name) return

    try {
      setIsSaving(true)
      await api.addEmployee({
        full_name: formData.name,
        job_title: formData.role || "Geral",
        department: formData.department || "Sede Antares",
        cpf: formData.cpf || "000.000.000-00",
        admission_date: new Date().toISOString(),
        active: true,
        workplace_id: formData.workplace_id || null
      })
      
      setLoading(true)
      await loadData() // Recarrega a lista
      setFormData({ name: "", role: "", department: "", cpf: "", workplace_id: "" })
      setIsModalOpen(false)
    } catch (error) {
      console.error("Erro ao salvar colaborador:", error)
      alert("Erro ao salvar no banco de dados. Verifique a conexão.")
    } finally {
      setIsSaving(false)
    }
  }

  const openProfile = async (empId: string) => {
    setSelectedEmployeeId(empId)
    setIsProfileOpen(true)
    setLoadingHistory(true)
    try {
      const history = await api.getEmployeeHistory(empId)
      setEmployeeHistory(history)
    } catch (err) {
      console.error("Erro ao carregar histórico:", err)
      alert("Falha ao carregar prontuário.")
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleReturnItem = async (deliveryId: string) => {
    const motive = prompt("Qual o motivo da devolução? (Ex: Desgaste, Erro, Fim de Contrato)")
    if (!motive) return

    try {
      await api.returnDelivery(deliveryId, motive)
      if (selectedEmployeeId) {
        const history = await api.getEmployeeHistory(selectedEmployeeId)
        setEmployeeHistory(history)
      }
    } catch (err) {
      console.error("Erro ao dar baixa:", err)
      alert("Erro ao registrar devolução.")
    }
  }

  const handleTerminateEmployee = async () => {
    if (!selectedEmployeeId) return
    const emp = employees.find(e => e.id === selectedEmployeeId)
    
    if (!confirm(`Deseja realmente DESLIGAR o colaborador ${emp?.full_name} e dar baixa em todos os seus EPIs ativos?`)) return
    
    try {
      setLoadingHistory(true)
      
      // 1. Desligar colaborador
      await api.terminateEmployee(selectedEmployeeId)
      
      // 2. Dar baixa em todos EPIs ativos
      const activeDeliveries = employeeHistory.filter(d => !d.returned_at)
      if (activeDeliveries.length > 0) {
        await api.returnMultipleDeliveries(activeDeliveries.map(d => d.id), "Desligamento")
      }
      
      await loadData()
      const history = await api.getEmployeeHistory(selectedEmployeeId)
      setEmployeeHistory(history)
      alert("Colaborador desligado e EPIs baixados com sucesso.")
    } catch (err) {
      console.error("Erro ao desligar:", err)
      alert("Erro ao processar desligamento.")
    } finally {
      setLoadingHistory(false)
    }
  }

  const exportNR06PDF = () => {
    if (!selectedEmployeeId) return
    const emp = employees.find(e => e.id === selectedEmployeeId)
    if (!emp) return

    const doc = new jsPDF()
    const emitDate = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
    
    doc.setFontSize(14)
    doc.setFont("helvetica", "bold")
    doc.text("FICHA DE CONTROLE DE EPI - NR 06", 105, 15, { align: "center" })
    
    doc.setFontSize(9)
    doc.setFont("helvetica", "normal")
    doc.text("EMPRESA: ANTARES EMPREENDIMENTOS S.A. | CNPJ: 12.345.678/0001-90", 14, 25)
    doc.text(`NOME: ${emp.full_name.toUpperCase()}`, 14, 31)
    doc.text(`CPF: ${emp.cpf} | CARGO: ${emp.job_title.toUpperCase()} | STATUS: ${emp.active ? 'ATIVO' : 'DESLIGADO'}`, 14, 37)
    
    doc.setFontSize(8)
    const term = "Declaro para os devidos fins de direito que recebi da empresa os Equipamentos de Proteção Individual listados abaixo. Comprometo-me a usá-los exclusivamente para a execução das minhas atividades, guardá-los e conservá-los, bem como comunicar imediatamente ao setor de Segurança do Trabalho qualquer alteração que os tornem impróprios para uso, cumprindo as determinações da NR-06."
    const splitTerm = doc.splitTextToSize(term, 182)
    doc.text(splitTerm, 14, 45)

    const tableData = employeeHistory.map(d => [
      format(new Date(d.delivery_date), "dd/MM/yyyy"),
      d.ppe?.name || "",
      d.ppe?.ca_number || "",
      d.quantity,
      d.reason,
      d.returned_at ? format(new Date(d.returned_at), "dd/MM/yyyy") : "-",
      d.signature_url ? "Assinatura Digital" : "Registro Eletrônico"
    ])

    autoTable(doc, {
      startY: 55,
      head: [['Data Entrega', 'Equipamento', 'C.A.', 'Qtd', 'Motivo Retirada', 'Devolução / Baixa', 'Validação']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [139, 26, 26], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 45 },
        2: { cellWidth: 15 },
        3: { cellWidth: 10 },
        4: { cellWidth: 35 },
        5: { cellWidth: 25 },
        6: { cellWidth: 30 }
      }
    })

    const finalY = (doc as any).lastAutoTable.finalY || 60
    doc.text(`Impresso em: ${emitDate} pelo Sistema Antares SESMT`, 14, finalY + 10)

    doc.save(`Ficha_NR06_${emp.full_name.replace(/\s+/g, '_')}.pdf`)
  }

  const getWorkplaceName = (id: string | null) => {
    return workplaces.find(w => w.id === id)?.name || "Geral / Sede"
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center">
            <Users className="w-6 h-6 mr-2 text-[#8B1A1A]" />
            Equipe Antares
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Gestão de prontuários de EPI sincronizada com o Supabase.</p>
        </div>
        {canEdit ? (
          <button 
            onClick={() => setIsModalOpen(true)}
            className="w-full sm:w-auto bg-[#8B1A1A] hover:bg-[#681313] text-white shadow-lg shadow-red-900/20 px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center whitespace-nowrap"
          >
            <Plus className="w-4 h-4 mr-2" />
            Novo Colaborador
          </button>
        ) : (
          <div className="bg-slate-100 text-slate-400 px-6 py-3 rounded-xl text-sm font-bold flex items-center italic cursor-not-allowed select-none whitespace-nowrap">
             <Lock className="w-4 h-4 mr-2 opacity-50" />
             Acesso Restrito
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 bg-slate-50/30">
          <div className="relative max-w-md w-full">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou CPF..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              title="Buscar colaborador"
              aria-label="Buscar colaborador por nome ou CPF"
              className="w-full bg-white border border-slate-200 text-slate-900 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-[#8B1A1A] transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto min-h-[200px] flex flex-col">
         {loading ? (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-end border-b border-slate-100 pb-8">
           <div className="space-y-2">
             <Skeleton className="h-4 w-32" />
             <Skeleton className="h-8 w-64" />
           </div>
           <Skeleton className="h-12 w-40" />
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
           <div className="p-5 border-b border-slate-100">
             <Skeleton className="h-10 w-64" />
           </div>
           {[...Array(5)].map((_, i) => (
             <div key={i} className="flex items-center gap-4 p-6 border-b border-slate-50 last:border-0">
                <Skeleton className="h-12 w-12" variant="circle" />
                <div className="flex-1 space-y-2">
                   <Skeleton className="h-4 w-1/4" />
                   <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-24" />
             </div>
           ))}
        </div>
      </div>
  ) : (
            <table className="w-full text-sm text-left">
                <thead className="text-[10px] text-slate-400 bg-white uppercase tracking-[0.2em] border-b border-slate-100 font-black">
                <tr>
                    <th className="px-6 py-5">Nome do Colaborador</th>
                    <th className="px-6 py-5">Cargo / Lotação</th>
                    <th className="px-6 py-5">Canteiro (Obra)</th>
                    <th className="px-6 py-5">Status</th>
                    <th className="px-6 py-5 text-right">Ações</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                {filteredEmployees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-5">
                        <p className="font-bold text-slate-800">{emp.full_name}</p>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">{emp.cpf}</p>
                    </td>
                    <td className="px-6 py-5 text-slate-500 font-medium italic">
                        {emp.job_title} <span className="mx-1 text-slate-200">•</span> {emp.department}
                    </td>
                    <td className="px-6 py-5">
                        <div className="flex items-center gap-1.5 text-slate-600 font-bold text-[11px] uppercase tracking-tighter">
                            <HardDrive className="w-3 h-3 text-[#8B1A1A]" />
                            {getWorkplaceName(emp.workplace_id)}
                        </div>
                    </td>
                    <td className="px-6 py-5">
                        <span className={`px-3 py-1 text-[10px] font-black uppercase rounded-full border ${
                        emp.active 
                            ? 'bg-green-50 text-green-700 border-green-200' 
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                        {emp.active ? 'Ativo' : 'Inativo'}
                        </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                        <button 
                          onClick={() => openProfile(emp.id)}
                          className="text-[#8B1A1A] hover:bg-red-50 font-black text-[10px] uppercase tracking-widest border border-red-100 bg-white px-3 py-2 rounded-lg shadow-sm transition-all"
                        >
                        Prontuário
                        </button>
                    </td>
                    </tr>
                ))}
                {filteredEmployees.length === 0 && (
                    <tr>
                        <td colSpan={5} className="px-6 py-10 text-center text-slate-400 italic font-medium">
                            Nenhum colaborador encontrado.
                        </td>
                    </tr>
                )}
                </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal Adicionar Colaborador */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl">Novo Cadastro Antares</h2>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Fechar modal"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleAddEmployee} className="p-8 space-y-5">
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome Completo</label>
                <input 
                  required
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] focus:outline-none transition-all font-bold" 
                  placeholder="Nome do colaborador"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">CPF</label>
                  <input 
                    type="text" 
                    value={formData.cpf}
                    onChange={(e) => setFormData({...formData, cpf: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] focus:outline-none transition-all font-bold" 
                    placeholder="000.000.000-00"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Setor</label>
                  <input 
                    type="text" 
                    value={formData.department}
                    onChange={(e) => setFormData({...formData, department: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] focus:outline-none transition-all font-bold" 
                    placeholder="Ex: Engenharia"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Função / Cargo</label>
                <input 
                  type="text" 
                  value={formData.role}
                  onChange={(e) => setFormData({...formData, role: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] focus:outline-none transition-all font-bold" 
                  placeholder="Cargo oficial"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="workplace_select" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Canteiro de Obra</label>
                <select 
                  id="workplace_select"
                  title="Selecionar canteiro de obra"
                  value={formData.workplace_id}
                  onChange={(e) => setFormData({...formData, workplace_id: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] focus:outline-none transition-all font-bold"
                >
                  <option value="">Sede Antares / Sem Canteiro</option>
                  {workplaces.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div className="pt-6 flex gap-3">
                <button 
                  type="button" 
                  disabled={isSaving}
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-4 text-xs font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isSaving}
                  className="flex-1 px-4 py-4 text-xs font-black text-white bg-[#8B1A1A] hover:bg-[#681313] rounded-xl shadow-lg shadow-red-900/10 uppercase tracking-widest transition-all flex items-center justify-center"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar Cadastro"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Prontuario */}
      {isProfileOpen && selectedEmployeeId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            {(() => {
              const emp = employees.find(e => e.id === selectedEmployeeId)
              return (
                <>
                  <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50/50">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="font-black text-slate-800 text-2xl tracking-tighter">{emp?.full_name}</h2>
                        {!emp?.active && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-black uppercase">Desligado</span>}
                      </div>
                      <p className="text-slate-500 text-sm font-medium mt-1">
                        {emp?.job_title} • CPF: {emp?.cpf} • Lotação: {getWorkplaceName(emp?.workplace_id || null)}
                      </p>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button 
                        onClick={exportNR06PDF}
                        disabled={loadingHistory || employeeHistory.length === 0}
                        className="flex-1 sm:flex-none bg-[#8B1A1A] hover:bg-[#681313] text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md flex items-center justify-center disabled:opacity-50"
                      >
                        <FileDown className="w-4 h-4 mr-2" /> Ficha NR-06
                      </button>
                      <button 
                        onClick={() => setIsProfileOpen(false)} 
                        className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 px-4 py-2.5 rounded-xl transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                    {loadingHistory ? (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#8B1A1A]" />
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="font-black text-slate-700 uppercase tracking-widest text-sm flex items-center">
                            <History className="w-4 h-4 mr-2 text-[#8B1A1A]" />
                            Histórico de Movimentações
                          </h3>
                        </div>
                        
                        <div className="space-y-3">
                          {employeeHistory.map((delivery) => (
                            <div key={delivery.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-4 group">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-black text-slate-800">{delivery.ppe?.name}</span>
                                  <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">CA {delivery.ppe?.ca_number}</span>
                                  <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded font-bold">Qtd: {delivery.quantity}</span>
                                </div>
                                <div className="text-xs text-slate-500 font-medium flex flex-wrap gap-x-4 gap-y-1">
                                  <span>Entregue: {format(new Date(delivery.delivery_date), "dd/MM/yyyy HH:mm")}</span>
                                  <span>Motivo: {delivery.reason}</span>
                                  {delivery.returned_at && (
                                    <span className="text-[#8B1A1A] font-bold">
                                      Baixado em: {format(new Date(delivery.returned_at), "dd/MM/yyyy")} ({delivery.return_motive})
                                    </span>
                                  )}
                                </div>
                              </div>
                              
                              {!delivery.returned_at && emp?.active && (
                                <button 
                                  onClick={() => handleReturnItem(delivery.id)}
                                  className="text-[#8B1A1A] hover:bg-red-50 text-[10px] font-black uppercase tracking-widest border border-red-100 px-4 py-2 rounded-xl transition-all self-start sm:self-auto"
                                >
                                  Dar Baixa
                                </button>
                              )}
                              {delivery.returned_at && (
                                <span className="flex items-center text-green-600 text-[10px] font-black uppercase tracking-widest self-start sm:self-auto bg-green-50 px-3 py-1.5 rounded-lg border border-green-200">
                                  <ShieldCheck className="w-3 h-3 mr-1" /> Devolvido
                                </span>
                              )}
                            </div>
                          ))}
                          {employeeHistory.length === 0 && (
                            <div className="text-center py-10 bg-white border border-slate-200 border-dashed rounded-2xl">
                              <ShieldAlert className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                              <p className="text-slate-500 font-medium">Nenhum EPI registrado no prontuário.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {emp?.active && (
                    <div className="p-4 border-t border-slate-200 bg-red-50/50 flex justify-end">
                      <button 
                        onClick={handleTerminateEmployee}
                        className="text-red-700 hover:bg-red-700 hover:text-white border border-red-200 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm flex items-center justify-center"
                      >
                        <UserMinus className="w-4 h-4 mr-2" />
                        Desligar Colaborador (Dar baixa em tudo)
                      </button>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
