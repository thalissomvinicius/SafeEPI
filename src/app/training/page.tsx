"use client"

import { useState, useEffect } from "react"
import { CheckCircle2, Award, Calendar, Search, Plus, X, Loader2 } from "lucide-react"
import { api } from "@/services/api"
import { Employee, Training } from "@/types/database"
import { format, addYears } from "date-fns"

export default function TrainingPage() {
  const [trainings, setTrainings] = useState<any[]>([])
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
    loadData()
  }, [])

  const handleAddTraining = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.employee_id) return

    try {
      setIsSaving(true)
      const completionDate = new Date(formData.completion_date)
      const expiryDate = addYears(completionDate, 1) // Validade padrão de 1 ano

      await api.addTraining({
        employee_id: formData.employee_id,
        training_name: formData.training_name,
        completion_date: formData.completion_date,
        expiry_date: format(expiryDate, "yyyy-MM-dd"),
        status: "Válido"
      })

      await loadData()
      setIsModalOpen(false)
    } catch (error) {
      console.error("Erro ao salvar treinamento:", error)
      alert("Erro ao salvar treinamento no banco de dados.")
    } finally {
      setIsSaving(false)
    }
  }

  const filteredTrainings = trainings.filter(t => 
    t.training_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.employee?.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
              <Award className="w-6 h-6 mr-2 text-[#8B1A1A]" />
              Treinamentos Antares
          </h1>
          <p className="text-slate-500 text-sm mt-1">Gestão de competências e normas regulamentadoras (NRs).</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-[#8B1A1A] hover:bg-[#681313] text-white shadow-lg shadow-red-900/20 px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center whitespace-nowrap"
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
                  <th className="px-6 py-4 text-right">Status</th>
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
                    <td className="px-6 py-4 text-right">
                      <span className={`px-3 py-1 text-[10px] font-black uppercase rounded-full border ${
                        rec.status === 'Válido' 
                          ? 'bg-green-50 text-green-700 border-green-200' 
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {rec.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredTrainings.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-slate-400 italic font-medium">
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl">Novo Certificado Antares</h2>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Fechar modal"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleAddTraining} className="p-8 space-y-5">
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Colaborador</label>
                <select 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold"
                  value={formData.employee_id}
                  onChange={(e) => setFormData({...formData, employee_id: e.target.value})}
                >
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo de Treinamento</label>
                <select 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold"
                  value={formData.training_name}
                  onChange={(e) => setFormData({...formData, training_name: e.target.value})}
                >
                  <option>Uso e Guarda de EPI (NR-06)</option>
                  <option>Integração de Segurança (NR-01)</option>
                  <option>Trabalho em Altura (NR-35)</option>
                  <option>Segurança Elétrica (NR-10)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Realização</label>
                <input 
                  type="date" 
                  value={formData.completion_date}
                  onChange={(e) => setFormData({...formData, completion_date: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold" 
                />
              </div>

              <p className="text-[10px] text-slate-400 italic">
                * A validade será calculada automaticamente para 1 ano a partir da data de realização.
              </p>

              <div className="pt-6 flex gap-3">
                <button 
                  type="button" 
                  disabled={isSaving}
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-4 text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isSaving}
                  className="flex-1 px-4 py-4 text-xs font-black text-white bg-[#8B1A1A] hover:bg-[#681313] rounded-xl uppercase tracking-widest transition-all flex items-center justify-center shadow-lg shadow-red-900/10"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar Certificado"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
