"use client"

import { useState, useEffect } from "react"
import { Shield, Plus, Search, AlertCircle, X, Loader2 } from "lucide-react"
import { api } from "@/services/api"
import { PPE } from "@/types/database"

export default function PpesPage() {
  const [ppes, setPpes] = useState<PPE[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState({ name: "", ca: "", valCa: "", cost: "" })
  const [isSaving, setIsSaving] = useState(false)

  const loadPpes = async () => {
    try {
      setLoading(true)
      const data = await api.getPpes()
      setPpes(data)
    } catch (error) {
      console.error("Erro ao carregar EPIs:", error)
      alert("Falha ao carregar catálogo de EPIs.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPpes()
  }, [])

  const filteredPpes = ppes.filter(ppe => 
    ppe.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    ppe.ca_number.includes(searchTerm)
  )

  const handleAddPpe = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name) return

    try {
      setIsSaving(true)
      await api.addPpe({
        name: formData.name,
        ca_number: formData.ca || "N/A",
        ca_expiry_date: formData.valCa || new Date().toISOString(),
        cost: parseFloat(formData.cost) || 0,
        manufacturer: "Genérico",
        lifespan_days: 180,
        active: true
      })
      
      await loadPpes()
      setFormData({ name: "", ca: "", valCa: "", cost: "" })
      setIsModalOpen(false)
    } catch (error) {
      console.error("Erro ao salvar EPI:", error)
      alert("Erro ao salvar EPI no banco de dados.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
            <Shield className="w-6 h-6 mr-2 text-[#8B1A1A]" />
            Catálogo Antares
          </h1>
          <p className="text-slate-500 text-sm mt-1">Gestão técnica de CAs sincronizada com o Supabase.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-[#8B1A1A] hover:bg-[#681313] text-white shadow-lg shadow-red-900/20 px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center whitespace-nowrap"
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo EPI
        </button>
      </div>

      <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 bg-slate-50/30">
          <div className="relative max-w-md w-full">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar por Nº CA ou Equipamento..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-200 text-slate-900 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-[#8B1A1A] transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto min-h-[200px] flex flex-col">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-[#8B1A1A]" />
                <p className="text-sm font-medium">Buscando EPIs no Supabase...</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
                <thead className="text-[10px] text-slate-400 bg-white uppercase tracking-[0.2em] border-b border-slate-100 font-black">
                <tr>
                    <th className="px-6 py-5">Equipamento</th>
                    <th className="px-6 py-5">Nº C.A.</th>
                    <th className="px-6 py-5">Validade</th>
                    <th className="px-6 py-5">Custo Unit.</th>
                    <th className="px-6 py-5 text-right">Ações</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                {filteredPpes.map((ppe) => (
                    <tr key={ppe.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-5 font-bold text-slate-800">
                        <div className="flex items-center">
                        {ppe.name}
                        {/* Lógica de alerta baseada em data futura pode ser disparada aqui */}
                        </div>
                    </td>
                    <td className="px-6 py-5 text-slate-500 font-mono font-bold tracking-tighter bg-slate-50/50 w-fit px-2 py-1 rounded">
                        CA {ppe.ca_number}
                    </td>
                    <td className="px-6 py-5">
                        <span className="text-xs font-bold text-slate-500">
                        {new Date(ppe.ca_expiry_date).toLocaleDateString()}
                        </span>
                    </td>
                    <td className="px-6 py-5 text-slate-600 font-bold italic">R$ {ppe.cost.toFixed(2)}</td>
                    <td className="px-6 py-5 text-right">
                        <button className="text-slate-400 hover:text-[#8B1A1A] font-black text-[10px] uppercase tracking-widest transition-all opacity-0 group-hover:opacity-100 italic underline">
                        Editar
                        </button>
                    </td>
                    </tr>
                ))}
                {filteredPpes.length === 0 && (
                    <tr>
                        <td colSpan={5} className="px-6 py-10 text-center text-slate-400 italic">
                            Nenhum EPI cadastrado no sistema.
                        </td>
                    </tr>
                )}
                </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal Adicionar EPI */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl">Novo EPI Antares</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleAddPpe} className="p-8 space-y-5">
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome do Equipamento</label>
                <input 
                  required
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold" 
                  placeholder="Ex: Bota de Couro"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Nº do C.A.</label>
                  <input 
                    type="text" 
                    value={formData.ca}
                    onChange={(e) => setFormData({...formData, ca: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold" 
                    placeholder="Ex: 54321"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Custo Unit. (R$)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={formData.cost}
                    onChange={(e) => setFormData({...formData, cost: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold" 
                    placeholder="00.00"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Vencimento do C.A.</label>
                <input 
                  type="date" 
                  value={formData.valCa}
                  onChange={(e) => setFormData({...formData, valCa: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold" 
                />
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
                  className="flex-1 px-4 py-4 text-xs font-black text-white bg-[#8B1A1A] hover:bg-[#681313] rounded-xl uppercase tracking-widest transition-all flex items-center justify-center font-bold"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar EPI"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
