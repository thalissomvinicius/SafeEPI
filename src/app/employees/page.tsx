"use client"

import { useState, useEffect } from "react"
import { Users, Plus, Search, X, Loader2, HardDrive } from "lucide-react"
import { api } from "@/services/api"
import { Employee, Workplace } from "@/types/database"

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // Form State
  const [formData, setFormData] = useState({ 
    name: "", 
    role: "", 
    department: "", 
    cpf: "",
    workplace_id: "" 
  })
  const [isSaving, setIsSaving] = useState(false)

  // Fetch real data from Supabase
  const loadData = async () => {
    try {
      setLoading(true)
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
    loadData()
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
        <button 
          onClick={() => setIsModalOpen(true)}
          className="w-full sm:w-auto bg-[#8B1A1A] hover:bg-[#681313] text-white shadow-lg shadow-red-900/20 px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center whitespace-nowrap"
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo Colaborador
        </button>
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
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#8B1A1A]" />
                <p className="text-sm font-medium">Buscando dados no Supabase...</p>
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
                        <button className="text-[#8B1A1A] hover:bg-red-50 font-black text-[10px] uppercase tracking-widest border border-red-100 bg-white px-3 py-2 rounded-lg shadow-sm transition-all opacity-0 group-hover:opacity-100">
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
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Canteiro de Obra</label>
                <select 
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
    </div>
  )
}
