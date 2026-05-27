// responsive: revisado — mobile-first ✓
"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { HardDrive, Plus, Search, MapPin, User, X, Loader2, CheckCircle2, Trash2, Users, Shield, AlertTriangle, Eye, Handshake } from "lucide-react"
import { api } from "@/services/api"
import { Workplace, Employee, DeliveryWithRelations, ThirdParty } from "@/types/database"
import { useAuth } from "@/contexts/AuthContext"
import { BottomSheet } from "@/components/ui/BottomSheet"
import { LoadingRows, LoadingState } from "@/components/ui/LoadingState"

export default function WorkplacesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const hasThirdPartyFeature = Boolean(user)

  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Details modal
  const [detailsWorkplace, setDetailsWorkplace] = useState<Workplace | null>(null)
  const [detailsEmployees, setDetailsEmployees] = useState<Employee[]>([])
  const [detailsDeliveries, setDetailsDeliveries] = useState<DeliveryWithRelations[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)

  // Delete modal
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; linkedEmp: number; linkedDel: number }>({ open: false, linkedEmp: 0, linkedDel: 0 })
  const [isDeleting, setIsDeleting] = useState(false)

  const [formData, setFormData] = useState<{ id?: string; name: string; address: string; manager_name: string; third_party_id: string }>({
    name: "", address: "", manager_name: "", third_party_id: ""
  })

  const thirdPartyById = useMemo(() => new Map(thirdParties.map((thirdParty) => [thirdParty.id, thirdParty])), [thirdParties])

  const loadWorkplaces = useCallback(async () => {
    try {
      const [data, thirdPartyData] = await Promise.all([
        api.getWorkplaces(),
        hasThirdPartyFeature ? api.getThirdParties() : Promise.resolve([] as ThirdParty[]),
      ])
      setWorkplaces(data)
      setThirdParties(thirdPartyData)
    } catch (error) {
      console.error("Erro ao carregar canteiros:", error)
    } finally {
      setLoading(false)
    }
  }, [hasThirdPartyFeature])

  useEffect(() => {
    const timer = setTimeout(() => { loadWorkplaces() }, 0)
    return () => clearTimeout(timer)
  }, [loadWorkplaces])

  const handleSaveWorkplace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name) return
    try {
      setIsSaving(true)
      const workplacePayload = {
        name: formData.name,
        address: formData.address,
        manager_name: formData.manager_name,
        ...(hasThirdPartyFeature ? { third_party_id: formData.third_party_id || null } : {}),
      }
      if (formData.id) {
        await api.updateWorkplace(formData.id, workplacePayload)
      } else {
        await api.addWorkplace({ ...workplacePayload, active: true })
      }
      setLoading(true)
      await loadWorkplaces()
      setIsModalOpen(false)
      setFormData({ id: undefined, name: "", address: "", manager_name: "", third_party_id: "" })
    } catch (error) {
      console.error("Erro ao salvar canteiro:", error)
      alert("Erro ao salvar canteiro no banco de dados.")
    } finally {
      setIsSaving(false)
    }
  }

  const openEditWorkplace = (w: Workplace) => {
    setFormData({ id: w.id, name: w.name, address: w.address || "", manager_name: w.manager_name || "", third_party_id: w.third_party_id || "" })
    setIsModalOpen(true)
  }

  const closeEditModal = () => {
    setFormData({ id: undefined, name: "", address: "", manager_name: "", third_party_id: "" })
    setIsModalOpen(false)
  }

  const openDetailsWorkplace = async (w: Workplace) => {
    setDetailsWorkplace(w)
    setDetailsLoading(true)
    try {
      const [allEmp, allDel] = await Promise.all([api.getEmployees(), api.getDeliveries()])
      setDetailsEmployees(allEmp.filter(e => e.workplace_id === w.id && e.active))
      setDetailsDeliveries(allDel.filter(d => d.workplace_id === w.id))
    } catch (err) {
      console.error("Erro ao carregar detalhes:", err)
    } finally {
      setDetailsLoading(false)
    }
  }

  const handleDeleteClick = async () => {
    if (!formData.id) return
    setIsDeleting(true)
    try {
      const [allEmp, allDel] = await Promise.all([api.getEmployees(), api.getDeliveries()])
      const linkedEmp = allEmp.filter(e => e.workplace_id === formData.id && e.active).length
      const linkedDel = allDel.filter(d => d.workplace_id === formData.id).length
      setDeleteModal({ open: true, linkedEmp, linkedDel })
    } catch (err) {
      console.error("Erro ao verificar vínculos:", err)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!formData.id) return
    try {
      setIsDeleting(true)
      await api.deleteWorkplace(formData.id)
      setLoading(true)
      await loadWorkplaces()
      setDeleteModal({ open: false, linkedEmp: 0, linkedDel: 0 })
      setIsModalOpen(false)
      setFormData({ id: undefined, name: "", address: "", manager_name: "", third_party_id: "" })
    } catch (err) {
      console.error("Erro ao desativar canteiro:", err)
      alert("Erro ao desativar canteiro.")
    } finally {
      setIsDeleting(false)
    }
  }

  const filteredWorkplaces = workplaces.filter(w =>
    w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.manager_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    thirdPartyById.get(w.third_party_id || "")?.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-[#2563EB] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-widest uppercase italic">Infraestrutura SafeEPI</span>
          </div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
            <HardDrive className="w-6 h-6 mr-2 text-[#2563EB]" />
            Obras e Canteiros
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Cadastro de obras, canteiros e locais operacionais da empresa.</p>
        </div>
        <button onClick={() => { setFormData({ id: undefined, name: "", address: "", manager_name: "", third_party_id: "" }); setIsModalOpen(true) }}
          title="Nova obra ou canteiro" className="w-full sm:w-auto bg-[#2563EB] hover:bg-[#1D4ED8] text-white shadow-lg shadow-blue-900/20 px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center whitespace-nowrap">
          <Plus className="w-4 h-4 mr-2" /> Nova Obra / Canteiro
        </button>
      </div>

      {/* Cards */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-200 bg-slate-50/50">
          <div className="relative w-full md:max-w-md">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Buscar por nome ou responsável..."
              value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="min-h-11 w-full bg-white border border-slate-200 text-slate-900 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[#2563EB] transition-all" />
          </div>
        </div>
        <div className="p-6">
          {loading ? (
            <LoadingState
              variant="panel"
              label="Sincronizando obras"
              detail="Buscando canteiros, tomadores e vinculos operacionais."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredWorkplaces.map((w) => (
                <div key={w.id} className="group p-6 bg-white border border-slate-100 rounded-2xl shadow-sm hover:border-[#2563EB]/30 transition-all hover:shadow-md relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-slate-50 rounded-full -mr-12 -mt-12 group-hover:bg-blue-50 transition-colors" />
                  <div className="flex items-center gap-3 mb-4 relative z-10">
                    <div className="bg-slate-100 p-2.5 rounded-xl group-hover:bg-[#2563EB] group-hover:text-white transition-colors">
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg leading-tight">{w.name}</h3>
                  </div>
                  <div className="space-y-2 relative z-10">
                    <div className="flex items-start gap-2 text-slate-500">
                      <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                      <span className="text-xs font-medium italic leading-relaxed">{w.address || "Sem endereço cadastrado"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-bold uppercase tracking-tight text-slate-600">Resp: {w.manager_name || "Não atribuído"}</span>
                    </div>
                    {hasThirdPartyFeature && w.third_party_id && (
                      <div className="flex items-center gap-2">
                        <Handshake className="w-4 h-4 text-slate-400" />
                        <span className="text-xs font-bold uppercase tracking-tight text-slate-600">Tomador: {thirdPartyById.get(w.third_party_id)?.trade_name || thirdPartyById.get(w.third_party_id)?.name || "Terceiro vinculado"}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-6 pt-4 border-t border-slate-50 flex justify-between items-center relative z-10">
                    <span className="px-2 py-0.5 bg-green-50 text-green-700 text-[8px] font-black rounded border border-green-100 uppercase tracking-widest">Operacional</span>
                    <div className="flex gap-3 items-center">
                      <button onClick={() => openEditWorkplace(w)}
                        className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-[#2563EB] transition-colors">
                        Editar
                      </button>
                      <button onClick={() => openDetailsWorkplace(w)}
                        className="text-[10px] font-black text-[#2563EB] uppercase tracking-widest hover:underline flex items-center gap-1">
                        <Eye className="w-3 h-3" /> Ver detalhes →
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredWorkplaces.length === 0 && (
                <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-100 rounded-3xl">
                  <p className="text-slate-400 text-sm italic font-medium">Nenhuma obra ou canteiro registrado.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Info block */}
      <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center">
        <CheckCircle2 className="w-12 h-12 text-[#2563EB]/20 mb-4" />
        <h3 className="font-bold text-slate-800 uppercase tracking-tighter italic">Vínculo Organizacional SafeEPI</h3>
        <p className="text-sm text-slate-400 max-w-md mt-2 leading-relaxed">O cadastro correto da obra ou canteiro permite a auditoria por geolocalização e o rateio preciso dos custos operacionais no Balanço BI.</p>
      </div>

      {/* --- MODAL: Ver Detalhes --- */}
      <BottomSheet
        open={Boolean(detailsWorkplace)}
        onClose={() => { setDetailsWorkplace(null); setDetailsEmployees([]); setDetailsDeliveries([]) }}
        className="md:max-w-lg"
        contentClassName="p-0"
      >
        {detailsWorkplace && (
          <div className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="bg-[#2563EB]/10 p-3 rounded-2xl">
                  <HardDrive className="w-5 h-5 text-[#2563EB]" />
                </div>
                <div>
                  <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl">{detailsWorkplace.name}</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Detalhes da Obra / Canteiro</p>
                </div>
              </div>
              <button 
                onClick={() => { setDetailsWorkplace(null); setDetailsEmployees([]); setDetailsDeliveries([]) }}
                title="Fechar detalhes"
                aria-label="Fechar detalhes"
                className="text-slate-300 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Meta info */}
              <div className="space-y-2">
                <div className="flex items-start gap-2 text-slate-600">
                  <MapPin className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
                  <span className="text-sm">{detailsWorkplace.address || "Sem endereço cadastrado"}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-bold">{detailsWorkplace.manager_name || "Responsável não atribuído"}</span>
                </div>
                {hasThirdPartyFeature && detailsWorkplace.third_party_id && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Handshake className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-bold">{thirdPartyById.get(detailsWorkplace.third_party_id)?.name || "Terceiro vinculado"}</span>
                  </div>
                )}
              </div>

              {/* Stats */}
              {detailsLoading ? (
                <LoadingRows rows={3} />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-center">
                      <Users className="w-6 h-6 text-blue-600 mx-auto mb-1" />
                      <p className="text-2xl font-black text-blue-700">{detailsEmployees.length}</p>
                      <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mt-0.5">Colaboradores Ativos</p>
                    </div>
                    <div className="bg-red-50 border border-blue-100 rounded-2xl p-4 text-center">
                      <Shield className="w-6 h-6 text-[#2563EB] mx-auto mb-1" />
                      <p className="text-2xl font-black text-[#2563EB]">{detailsDeliveries.length}</p>
                      <p className="text-[10px] font-black text-blue-300 uppercase tracking-widest mt-0.5">Entregas de EPI</p>
                    </div>
                  </div>

                  {detailsEmployees.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Colaboradores Vinculados</p>
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {detailsEmployees.slice(0, 8).map(emp => (
                          <div key={emp.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl">
                            <div className="w-6 h-6 rounded-full bg-[#2563EB]/10 flex items-center justify-center shrink-0">
                              <User className="w-3 h-3 text-[#2563EB]" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-800 uppercase tracking-tight">{emp.full_name}</p>
                              <p className="text-[9px] text-slate-400">{emp.job_title}</p>
                            </div>
                          </div>
                        ))}
                        {detailsEmployees.length > 8 && (
                          <p className="text-[10px] text-slate-400 text-center italic">+{detailsEmployees.length - 8} colaboradores...</p>
                        )}
                      </div>
                    </div>
                  )}

                  {detailsEmployees.length === 0 && (
                    <div className="py-4 text-center">
                      <p className="text-xs text-slate-400 italic">Nenhum colaborador ativo vinculado a esta obra ou canteiro.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </BottomSheet>

      {/* --- MODAL: Editar / Adicionar --- */}
      <BottomSheet
        open={isModalOpen}
        onClose={closeEditModal}
        className="md:max-w-lg"
        contentClassName="p-0"
      >
          <div className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex justify-between items-center p-5 sm:p-8 border-b border-slate-50">
              <div>
                <h2 className="font-black text-slate-800 uppercase tracking-tighter text-2xl">{formData.id ? 'Editar Ponto Operacional' : 'Novo Ponto Operacional'}</h2>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1 italic">{formData.id ? 'Atualização de Cadastro' : 'Expansão de Infraestrutura'}</p>
              </div>
              <button onClick={closeEditModal} title="Fechar" className="text-slate-300 hover:text-slate-600 p-2 hover:bg-slate-50 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleSaveWorkplace} className="space-y-6 p-5 sm:p-8">
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Nome da Obra / Canteiro</label>
                <input type="text" required placeholder="Ex: Residencial SafeEPI I"
                    className="min-h-11 w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:border-[#2563EB] focus:bg-white transition-all font-bold placeholder:font-normal"
                  value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Responsável / Mestre de Obra</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type="text" placeholder="Nome do encarregado"
                    className="min-h-11 w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-5 py-4 text-sm focus:border-[#2563EB] focus:bg-white transition-all font-bold placeholder:font-normal"
                    value={formData.manager_name} onChange={(e) => setFormData({ ...formData, manager_name: e.target.value })} />
                </div>
              </div>
              {hasThirdPartyFeature && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Tomador / Terceiro</label>
                  <div className="relative">
                    <Handshake className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <select
                      className="min-h-11 w-full appearance-none bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-5 py-4 text-sm focus:border-[#2563EB] focus:bg-white transition-all font-bold"
                      value={formData.third_party_id}
                      onChange={(e) => setFormData({ ...formData, third_party_id: e.target.value })}
                    >
                      <option value="">Sem terceiro vinculado</option>
                      {thirdParties.filter((thirdParty) => thirdParty.active).map((thirdParty) => (
                        <option key={thirdParty.id} value={thirdParty.id}>
                          {thirdParty.trade_name || thirdParty.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Endereço / Localização</label>
                <div className="relative">
                  <MapPin className="absolute left-4 top-4 w-4 h-4 text-slate-400" />
                  <textarea rows={3} placeholder="Rua, Número, Bairro, Cidade..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-5 py-4 text-sm focus:border-[#2563EB] focus:bg-white transition-all font-bold placeholder:font-normal resize-none"
                    value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
                </div>
              </div>
              <div className="pt-2 flex flex-col gap-3">
                <div className="flex gap-4">
                  <button type="button" disabled={isSaving} onClick={closeEditModal}
                    className="min-h-11 flex-1 px-4 py-4 text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-[0.2em] transition-all">
                    Cancelar
                  </button>
                  <button type="submit" disabled={isSaving}
                    className="flex min-h-11 flex-[2] items-center justify-center rounded-2xl bg-[#2563EB] px-4 py-4 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-blue-900/15 transition-all hover:bg-[#1D4ED8]">
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : formData.id ? "Salvar Edição" : "Ativar Obra / Canteiro"}
                  </button>
                </div>
                {isAdmin && formData.id && (
                  <button type="button" disabled={isSaving || isDeleting} onClick={handleDeleteClick}
                    className="w-full py-3 text-[10px] font-black text-slate-400 hover:text-red-600 uppercase tracking-widest border border-slate-200 hover:border-red-200 hover:bg-red-50 rounded-2xl flex items-center justify-center gap-2 transition-all">
                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Desativar / Excluir Obra
                  </button>
                )}
              </div>
            </form>
          </div>
      </BottomSheet>

      {/* --- MODAL: Confirmação de Exclusão --- */}
      <BottomSheet
        open={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, linkedEmp: 0, linkedDel: 0 })}
        className="md:max-w-md"
        contentClassName="p-0"
      >
          <div className="w-full overflow-hidden rounded-3xl border-2 border-blue-200 bg-white shadow-2xl">
            <div className="bg-red-50 p-6 border-b border-blue-100 flex items-start gap-4">
              <div className="p-3 bg-red-100 rounded-2xl shrink-0">
                <AlertTriangle className="w-6 h-6 text-[#2563EB]" />
              </div>
              <div>
                <h2 className="font-black text-slate-800 uppercase tracking-tighter text-xl">Atenção - Risco de Dados</h2>
                <p className="text-xs text-[#2563EB] font-bold uppercase tracking-widest mt-1">Confirmação exigida - ADMIN</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Você está prestes a <strong>desativar</strong> a obra/canteiro <strong className="text-slate-800">&quot;{formData.name}&quot;</strong>.
                Os dados serão preservados no histórico de auditoria, mas a obra/canteiro ficará invisível na plataforma.
              </p>

              {(deleteModal.linkedEmp > 0 || deleteModal.linkedDel > 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
                  <p className="text-xs font-black text-amber-700 uppercase tracking-widest flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Vínculos Ativos Detectados
                  </p>
                  {deleteModal.linkedEmp > 0 && (
                    <p className="text-sm text-amber-700">• <strong>{deleteModal.linkedEmp}</strong> colaborador{deleteModal.linkedEmp !== 1 ? 'es' : ''} vinculado{deleteModal.linkedEmp !== 1 ? 's' : ''} a esta obra/canteiro</p>
                  )}
                  {deleteModal.linkedDel > 0 && (
                    <p className="text-sm text-amber-700">• <strong>{deleteModal.linkedDel}</strong> entrega{deleteModal.linkedDel !== 1 ? 's' : ''} de EPI registrada{deleteModal.linkedDel !== 1 ? 's' : ''}</p>
                  )}
                  <p className="text-xs text-amber-600 italic">Desativar pode afetar relatórios e rastreabilidade de EPIs.</p>
                </div>
              )}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <button onClick={() => setDeleteModal({ open: false, linkedEmp: 0, linkedDel: 0 })}
                  className="min-h-11 flex-1 px-4 py-3 text-[10px] font-black text-slate-500 hover:text-slate-700 uppercase tracking-widest border border-slate-200 rounded-2xl transition-all">
                  Cancelar
                </button>
                <button onClick={handleConfirmDelete} disabled={isDeleting}
                  className="flex min-h-11 flex-[2] items-center justify-center gap-2 rounded-2xl bg-[#2563EB] px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-red-700">
                  {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Confirmar Desativação
                </button>
              </div>
            </div>
          </div>
      </BottomSheet>
    </div>
  )
}


