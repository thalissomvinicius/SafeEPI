"use client"

import { useState, useEffect } from "react"
import { HardDrive, Plus, Search, MapPin, User, X, Loader2, CheckCircle2 } from "lucide-react"
import { api } from "@/services/api"
import { Workplace } from "@/types/database"

export default function WorkplacesPage() {
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Form State
  const [formData, setFormData] = useState<{id?: string, name: string, address: string, manager_name: string}>({
    name: "",
    address: "",
    manager_name: "",
  })

  const loadWorkplaces = async () => {
    try {
      // Removed synchronous setLoading(true) to avoid cascading renders in useEffect.
      // Loading is initialized to true.
      const data = await api.getWorkplaces()
      setWorkplaces(data)
    } catch (error) {
      console.error("Erro ao carregar canteiros:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      loadWorkplaces()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  const handleSaveWorkplace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name) return

    try {
      setIsSaving(true)
      if (formData.id) {
        await api.updateWorkplace(formData.id, {
          name: formData.name,
          address: formData.address,
          manager_name: formData.manager_name
        })
      } else {
        await api.addWorkplace({ name: formData.name, address: formData.address, manager_name: formData.manager_name, active: true })
      }
      setLoading(true)
      await loadWorkplaces()
      setIsModalOpen(false)
      setFormData({ id: undefined, name: "", address: "", manager_name: "" })
    } catch (error) {
      console.error("Erro ao salvar canteiro:", error)
      alert("Erro ao salvar canteiro no banco de dados.")
    } finally {
      setIsSaving(false)
    }
  }

  const openEditWorkplace = (w: Workplace) => {
    setFormData({
      id: w.id,
      name: w.name,
      address: w.address || "",
      manager_name: w.manager_name || ""
    })
    setIsModalOpen(true)
  }

  const closeEditModal = () => {
    setFormData({ id: undefined, name: "", address: "", manager_name: "" })
    setIsModalOpen(false)
  }

  const filteredWorkplaces = workplaces.filter(w => 
    w.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    w.manager_name?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
            <div className="flex items-center gap-2 mb-1">
                <span className="bg-[#8B1A1A] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-widest uppercase italic">Infraestrutura Antares</span>
            </div>
            <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
                <HardDrive className="w-6 h-6 mr-2 text-[#8B1A1A]" />
                Gestão de Canteiros
            </h1>
            <p className="text-slate-500 text-sm mt-1 font-medium">Controle de locais de obra, unidades produtivas e centros de custo.</p>
        </div>
        <button 
          onClick={() => {
            setFormData({ id: undefined, name: "", address: "", manager_name: "" })
            setIsModalOpen(true)
          }}
          title="Abrir formulário de novo canteiro"
          className="w-full sm:w-auto bg-[#8B1A1A] hover:bg-[#681313] text-white shadow-lg shadow-red-900/20 px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center whitespace-nowrap"
        >
          <Plus className="w-4 h-4 mr-2" />
          Novo Canteiro
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-200 bg-slate-50/50">
          <div className="relative max-w-md">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou responsável..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-200 text-slate-900 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[#8B1A1A] transition-all"
            />
          </div>
        </div>
        
        <div className="p-6">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-[#8B1A1A] mb-2" />
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sincronizando com Supabase...</p>
             </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredWorkplaces.map((w) => (
                <div key={w.id} className="group p-6 bg-white border border-slate-100 rounded-2xl shadow-sm hover:border-[#8B1A1A]/30 transition-all hover:shadow-md relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-slate-50 rounded-full -mr-12 -mt-12 transition-colors group-hover:bg-red-50"></div>
                  
                  <div className="flex items-center gap-3 mb-4 relative z-10">
                    <div className="bg-slate-100 p-2.5 rounded-xl group-hover:bg-[#8B1A1A] group-hover:text-white transition-colors">
                        <HardDrive className="w-5 h-5" />
                    </div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg">{w.name}</h3>
                  </div>

                  <div className="space-y-3 relative z-10">
                    <div className="flex items-start gap-2 text-slate-500">
                        <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                        <span className="text-xs font-medium italic leading-relaxed">{w.address || "Sem endereço cadastrado"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-500">
                        <User className="w-4 h-4 text-slate-400" />
                        <span className="text-xs font-bold uppercase tracking-tight text-slate-600">Resp: {w.manager_name || "Não atribuído"}</span>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-50 flex justify-between items-center relative z-10">
                    <span className="px-2 py-0.5 bg-green-50 text-green-700 text-[8px] font-black rounded border border-green-100 uppercase tracking-widest">Operacional</span>
                    <div className="flex gap-3">
                        <button 
                            onClick={() => openEditWorkplace(w)}
                            className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-[#8B1A1A] transition-colors"
                        >
                            Editar
                        </button>
                        <button className="text-[10px] font-black text-[#8B1A1A] uppercase tracking-widest hover:underline">Ver detalhes →</button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredWorkplaces.length === 0 && (
                <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-100 rounded-3xl">
                    <p className="text-slate-400 text-sm italic font-medium">Nenhum canteiro registrado no banco de dados.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center">
        <CheckCircle2 className="w-12 h-12 text-[#8B1A1A]/20 mb-4" />
        <h3 className="font-bold text-slate-800 uppercase tracking-tighter italic">Vínculo Organizacional Antares</h3>
        <p className="text-sm text-slate-400 max-w-md mt-2 leading-relaxed">
          O cadastro correto do canteiro permite a auditoria por geolocalização e o rateio preciso dos custos operacionais no Balanço BI.
        </p>
      </div>

      {/* Modal Adicionar Canteiro */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="flex justify-between items-center p-5 sm:p-8 border-b border-slate-50">
              <div>
                <h2 className="font-black text-slate-800 uppercase tracking-tighter text-2xl">{formData.id ? 'Editar Ponto Operacional' : 'Novo Ponto Operacional'}</h2>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1 italic">{formData.id ? 'Atualização de Cadastro' : 'Expansão de Infraestrutura'}</p>
              </div>
              <button 
                onClick={closeEditModal} 
                title="Fechar modal"
                aria-label="Fechar modal de cadastro de canteiro"
                className="text-slate-300 hover:text-slate-600 transition-colors p-2 hover:bg-slate-50 rounded-full"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleSaveWorkplace} className="p-5 sm:p-8 space-y-6">
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Nome do Canteiro / Obra</label>
                <input 
                  type="text" 
                  required
                  placeholder="Ex: Residencial Antares I"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:border-[#8B1A1A] focus:bg-white transition-all font-bold placeholder:font-normal"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Responsável / Mestre de Obra</label>
                <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                        type="text" 
                        placeholder="Nome do encarregado"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-5 py-4 text-sm focus:border-[#8B1A1A] focus:bg-white transition-all font-bold placeholder:font-normal"
                        value={formData.manager_name}
                        onChange={(e) => setFormData({...formData, manager_name: e.target.value})}
                    />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Endereço / Localização</label>
                <div className="relative">
                    <MapPin className="absolute left-4 top-4 w-4 h-4 text-slate-400" />
                    <textarea 
                        rows={3}
                        placeholder="Rua, Número, Bairro, Cidade..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-5 py-4 text-sm focus:border-[#8B1A1A] focus:bg-white transition-all font-bold placeholder:font-normal resize-none"
                        value={formData.address}
                        onChange={(e) => setFormData({...formData, address: e.target.value})}
                    ></textarea>
                </div>
              </div>

              <div className="pt-6 flex gap-4">
                <button 
                  type="button" 
                  disabled={isSaving}
                  onClick={closeEditModal}
                  className="flex-1 px-4 py-4 text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-[0.2em] transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isSaving}
                  className="flex-[2] px-4 py-4 text-xs font-black text-white bg-[#8B1A1A] hover:bg-[#681313] rounded-2xl uppercase tracking-widest transition-all shadow-xl shadow-red-900/20 flex items-center justify-center border-b-4 border-red-900"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : formData.id ? "Salvar Edição" : "Ativar Canteiro"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
