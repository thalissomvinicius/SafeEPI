"use client"

import { useState, useEffect } from "react"
import { Shield, Plus, Search, X, Loader2, Package } from "lucide-react"
import { api } from "@/services/api"
import { PPE } from "@/types/database"
import { Skeleton } from "@/components/ui/Skeleton"
import Link from "next/link"
import { COMPANY_CONFIG } from "@/config/company"

export default function PpesPage() {
  const [ppes, setPpes] = useState<PPE[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState<{id?: string, name: string, ca: string, valCa: string, cost: string, stock: string}>({ name: "", ca: "", valCa: "", cost: "", stock: "" })
  const [isSaving, setIsSaving] = useState(false)

  const loadPpes = async () => {
    try {
      // Removed synchronous setLoading(true) to avoid cascading renders in useEffect.
      // Loading is initialized to true.
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
    const timer = setTimeout(() => {
      loadPpes()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  const filteredPpes = ppes.filter(ppe => 
    ppe.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    ppe.ca_number.includes(searchTerm)
  )

  const handleSavePpe = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name) return

    try {
      setIsSaving(true)
      
      if (formData.id) {
        await api.updatePpe(formData.id, {
          name: formData.name,
          ca_number: formData.ca || "N/A",
          ca_expiry_date: formData.valCa || new Date().toISOString(),
          cost: parseFloat(formData.cost) || 0,
        })
      } else {
        const newPpe = await api.addPpe({
          name: formData.name,
          ca_number: formData.ca || "N/A",
          ca_expiry_date: formData.valCa || new Date().toISOString(),
          cost: parseFloat(formData.cost) || 0,
          manufacturer: "Genérico",
          lifespan_days: 180,
          active: true,
          current_stock: parseInt(formData.stock) || 0
        })

        if (parseInt(formData.stock) > 0) {
          await api.addStockMovement({
            ppe_id: newPpe.id,
            quantity: parseInt(formData.stock),
            type: 'ENTRADA',
            motive: 'Saldo Inicial (Cadastro)'
          })
        }
      }
      
      setLoading(true)
      await loadPpes()
      setFormData({ id: undefined, name: "", ca: "", valCa: "", cost: "", stock: "" })
      setIsModalOpen(false)
    } catch (error) {
      console.error("Erro ao salvar EPI:", error)
      alert("Erro ao salvar EPI no banco de dados.")
    } finally {
      setIsSaving(false)
    }
  }

  const openEditPpe = (ppe: PPE) => {
    setFormData({
      id: ppe.id,
      name: ppe.name,
      ca: ppe.ca_number,
      valCa: ppe.ca_expiry_date ? ppe.ca_expiry_date.split('T')[0] : "",
      cost: ppe.cost.toString(),
      stock: ppe.current_stock.toString()
    })
    setIsModalOpen(true)
  }

  const closeEditModal = () => {
    setFormData({ id: undefined, name: "", ca: "", valCa: "", cost: "", stock: "" })
    setIsModalOpen(false)
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
           <div className="flex items-center gap-2 mb-1">
             <span className="bg-[#8B1A1A] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-widest uppercase italic">Catálogo Técnico {COMPANY_CONFIG.shortName}</span>
          </div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase text-3xl sm:text-2xl">
            <Shield className="w-6 h-6 mr-2 text-[#8B1A1A]" />
            EPIs e CAs {COMPANY_CONFIG.shortName}
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Gestão técnica de conformidade no {COMPANY_CONFIG.systemName}.</p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
            <Link 
                href="/inventory"
                className="flex-1 sm:flex-none border border-slate-200 bg-white text-slate-600 px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center hover:bg-slate-50"
            >
                <Package className="w-4 h-4 mr-2 text-[#8B1A1A]" />
                Estoque
            </Link>
            <button 
                onClick={() => {
                  setFormData({ id: undefined, name: "", ca: "", valCa: "", cost: "", stock: "" })
                  setIsModalOpen(true)
                }}
                className="flex-1 sm:flex-none bg-[#8B1A1A] hover:bg-[#681313] text-white shadow-lg shadow-red-900/20 px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center border-b-4 border-red-900"
            >
                <Plus className="w-4 h-4 mr-2" />
                Novo EPI
            </button>
        </div>
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
              <div className="w-full space-y-4 p-4">
                  {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center space-x-6 py-5 border-b border-slate-50 last:border-0">
                          <div className="flex-1 space-y-2">
                              <Skeleton className="h-5 w-2/3" />
                              <Skeleton className="h-3 w-1/3" />
                          </div>
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-4 w-16" />
                          <Skeleton className="h-4 w-20" />
                          <Skeleton className="h-8 w-8" variant="circle" />
                      </div>
                  ))}
              </div>
          ) : (
            <table className="w-full text-sm text-left">
                <thead className="text-[10px] text-slate-400 bg-white uppercase tracking-[0.2em] border-b border-slate-100 font-black">
                <tr>
                    <th className="px-6 py-5">Equipamento</th>
                    <th className="px-6 py-5">Identificação (C.A)</th>
                    <th className="px-6 py-5 text-center">Saldo em Estoque</th>
                    <th className="px-6 py-5">Custo Unit.</th>
                    <th className="px-6 py-5 text-right">Ações</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                {filteredPpes.map((ppe) => (
                    <tr key={ppe.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-5">
                        <p className="font-bold text-slate-800 uppercase tracking-tighter truncate max-w-[200px]">{ppe.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Validade: {new Date(ppe.ca_expiry_date).toLocaleDateString()}</p>
                    </td>
                    <td className="px-6 py-5">
                        <span className="text-slate-500 font-mono font-black tracking-tighter bg-slate-100 px-2 py-1 rounded text-xs">
                          CA {ppe.ca_number}
                        </span>
                    </td>
                    <td className="px-6 py-5 text-center">
                        <div className="flex flex-col items-center">
                            <span className={`text-lg font-black tracking-tighter ${ppe.current_stock <= 5 ? 'text-[#8B1A1A]' : 'text-slate-700'}`}>
                                {ppe.current_stock || 0}
                            </span>
                            {ppe.current_stock <= 5 && (
                                <span className="text-[8px] font-black text-[#8B1A1A] uppercase tracking-widest bg-red-50 px-1.5 py-0.5 rounded border border-red-100">Repor!</span>
                            )}
                        </div>
                    </td>
                    <td className="px-6 py-5 text-slate-600 font-bold italic">R$ {ppe.cost.toFixed(2)}</td>
                    <td className="px-6 py-5 text-right space-x-3">
                        <button 
                            onClick={() => openEditPpe(ppe)}
                            className="text-slate-500 hover:bg-slate-100 font-black text-[10px] uppercase tracking-widest border border-slate-200 bg-white px-3 py-2 rounded-lg shadow-sm transition-all"
                        >
                            Editar
                        </button>
                        <Link 
                            href="/inventory"
                            title="Gerenciar estoque deste item"
                            className="text-slate-400 hover:text-[#8B1A1A] font-black text-[10px] uppercase tracking-widest transition-all opacity-0 group-hover:opacity-100 italic"
                        >
                        Estoque
                        </Link>
                    </td>
                    </tr>
                ))}
                {filteredPpes.length === 0 && (
                    <tr>
                        <td colSpan={5} className="px-6 py-10 text-center text-slate-400 italic">
                            Nenhum EPI cadastrado.
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
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="flex justify-between items-center p-5 sm:p-8 border-b border-slate-100">
              <h2 className="font-black text-slate-800 uppercase tracking-tighter text-2xl tracking-tighter">{formData.id ? 'Editar EPI' : 'Novo Item Antares'}</h2>
              <button 
                onClick={closeEditModal} 
                title="Fechar modal"
                aria-label="Fechar modal de cadastro de EPI"
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleSavePpe} className="p-5 sm:p-8 space-y-6">
              <div className="space-y-2">
                <label htmlFor="ppe-name" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome do Equipamento (EPI)</label>
                <input 
                  id="ppe-name"
                  required
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:border-[#8B1A1A] transition-all font-bold" 
                  placeholder="Ex: Óculos de Proteção"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="ppe-ca" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Nº do C.A.</label>
                  <input 
                    id="ppe-ca"
                    type="text" 
                    value={formData.ca}
                    onChange={(e) => setFormData({...formData, ca: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold" 
                    placeholder="Ex: 54321"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="ppe-cost" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Custo Unitário (R$)</label>
                  <input 
                    id="ppe-cost"
                    type="number" 
                    step="0.01"
                    value={formData.cost}
                    onChange={(e) => setFormData({...formData, cost: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold" 
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="ppe-stock" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Saldo Inicial (Qtd)</label>
                  <input 
                    id="ppe-stock"
                    type="number" 
                    min="0"
                    value={formData.stock}
                    onChange={(e) => setFormData({...formData, stock: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold disabled:opacity-50" 
                    placeholder="0"
                    disabled={!!formData.id}
                    title={formData.id ? "O estoque deve ser gerenciado na tela de Estoque" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="ppe-expiry" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Vencimento do C.A.</label>
                  <input 
                    id="ppe-expiry"
                    type="date" 
                    value={formData.valCa}
                    onChange={(e) => setFormData({...formData, valCa: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] transition-all font-bold" 
                  />
                </div>
              </div>

              <div className="pt-6 flex gap-4">
                <button 
                  type="button" 
                  disabled={isSaving}
                  onClick={closeEditModal}
                  className="flex-1 px-4 py-4 text-xs font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isSaving}
                  className="flex-[2] px-4 py-4 text-xs font-black text-white bg-[#8B1A1A] hover:bg-[#681313] rounded-2xl uppercase tracking-widest transition-all flex items-center justify-center font-bold border-b-4 border-red-900 shadow-xl shadow-red-900/10"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : formData.id ? "Salvar Edição" : "Ativar no Catálogo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
