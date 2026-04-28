"use client"

import { useEffect, useState } from "react"
import { BriefcaseBusiness, Building2, Loader2, Plus, Search, Trash2, X } from "lucide-react"
import { api } from "@/services/api"
import { CatalogItem } from "@/types/database"
import { toast } from "sonner"

type CatalogKind = "job" | "department"

const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR")
const formatTypingName = (value: string) => value.toLocaleUpperCase("pt-BR")

export default function JobSectorsPage() {
  const [jobTitles, setJobTitles] = useState<CatalogItem[]>([])
  const [departments, setDepartments] = useState<CatalogItem[]>([])
  const [activeTab, setActiveTab] = useState<CatalogKind>("job")
  const [searchTerm, setSearchTerm] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [schemaWarning, setSchemaWarning] = useState("")
  const [formData, setFormData] = useState<{ id?: string; name: string }>({ name: "" })

  const loadData = async () => {
    try {
      setSchemaWarning("")
      const [jobs, depts] = await Promise.all([api.getJobTitles(), api.getDepartments()])
      setJobTitles(jobs)
      setDepartments(depts)
    } catch (error) {
      console.error("Erro ao carregar cargos e setores:", error)
      setSchemaWarning("Não foi possível carregar o cadastro de cargos e setores. Verifique se o SQL supabase_job_sector_catalog.sql já foi executado no Supabase.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => { loadData() }, 0)
    return () => clearTimeout(timer)
  }, [])

  const items = activeTab === "job" ? jobTitles : departments
  const filteredItems = items.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
  const title = activeTab === "job" ? "Cargos" : "Setores"
  const singularTitle = activeTab === "job" ? "Cargo" : "Setor"
  const Icon = activeTab === "job" ? BriefcaseBusiness : Building2

  const resetForm = () => setFormData({ id: undefined, name: "" })

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    const name = normalizeName(formData.name)
    if (!name) return

    try {
      setSaving(true)
      if (activeTab === "job") {
        if (formData.id) await api.updateJobTitle(formData.id, name)
        else await api.addJobTitle(name)
      } else {
        if (formData.id) await api.updateDepartment(formData.id, name)
        else await api.addDepartment(name)
      }

      toast.success(`${singularTitle} salvo em maiúsculo.`)
      resetForm()
      setLoading(true)
      await loadData()
    } catch (error) {
      console.error("Erro ao salvar catálogo:", error)
      const message = error instanceof Error ? error.message : "Erro ao salvar cadastro."
      toast.error(message)
      setSchemaWarning(message)
    } finally {
      setSaving(false)
      setLoading(false)
    }
  }

  const handleDelete = async (item: CatalogItem) => {
    if (!confirm(`Desativar "${item.name}"? Colaboradores antigos continuam com o histórico salvo.`)) return

    try {
      if (activeTab === "job") await api.deleteJobTitle(item.id)
      else await api.deleteDepartment(item.id)
      toast.success("Cadastro desativado.")
      setLoading(true)
      await loadData()
    } catch (error) {
      console.error("Erro ao desativar item:", error)
      toast.error("Erro ao desativar cadastro.")
    } finally {
      setLoading(false)
    }
  }

  const openEdit = (item: CatalogItem) => setFormData({ id: item.id, name: item.name })

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row justify-between gap-4 lg:items-end">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-[#8B1A1A] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-widest uppercase italic">Padrão RH Antares</span>
          </div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
            <BriefcaseBusiness className="w-6 h-6 mr-2 text-[#8B1A1A]" />
            Cargos e Setores
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Cadastre opções padronizadas para usar no cadastro dos colaboradores.</p>
        </div>

        <div className="bg-slate-100 rounded-xl p-1 flex w-full sm:w-auto">
          <button
            onClick={() => { setActiveTab("job"); resetForm() }}
            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === "job" ? "bg-white text-[#8B1A1A] shadow-sm" : "text-slate-400"}`}
          >
            Cargos
          </button>
          <button
            onClick={() => { setActiveTab("department"); resetForm() }}
            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === "department" ? "bg-white text-[#8B1A1A] shadow-sm" : "text-slate-400"}`}
          >
            Setores
          </button>
        </div>
      </div>

      {schemaWarning && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm font-bold">
          {schemaWarning}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 h-fit space-y-5">
          <div className="flex items-center gap-3">
            <div className="bg-red-50 text-[#8B1A1A] rounded-xl p-3">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-black text-slate-800 uppercase tracking-tighter">{formData.id ? `Editar ${singularTitle}` : `Novo ${singularTitle}`}</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Salvo sempre em maiúsculo</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(event) => setFormData({ ...formData, name: formatTypingName(event.target.value) })}
              placeholder={activeTab === "job" ? "EX: AUXILIAR ADMINISTRATIVO" : "EX: ALMOXARIFADO"}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-[#8B1A1A] focus:outline-none transition-all font-bold uppercase"
            />
          </div>

          <div className="flex gap-3">
            {formData.id && (
              <button type="button" onClick={resetForm} className="px-4 py-3 text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest">
                Cancelar
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-[#8B1A1A] hover:bg-[#681313] text-white shadow-lg shadow-red-900/20 px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {formData.id ? "Salvar Alteração" : `Cadastrar ${singularTitle}`}
            </button>
          </div>
        </form>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-5 border-b border-slate-200 bg-slate-50/50">
            <div className="relative max-w-md">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={`Buscar ${title.toLowerCase()}...`}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full bg-white border border-slate-200 text-slate-900 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[#8B1A1A] transition-all"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-50 min-h-[320px]">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-[#8B1A1A] mb-2" />
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Carregando cadastros...</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="py-24 text-center px-6">
                <p className="text-slate-400 text-sm italic font-medium">Nenhum cadastro encontrado.</p>
                <p className="text-slate-400 text-xs mt-2">Cadastre pelo formulário ao lado para liberar a seleção no cadastro de colaboradores.</p>
              </div>
            ) : (
              filteredItems.map(item => (
                <div key={item.id} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50/60 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-slate-100 rounded-xl p-2.5 text-slate-500">
                      <Icon className="w-4 h-4" />
                    </div>
                    <p className="font-black text-slate-800 uppercase tracking-tight truncate">{item.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(item)}
                      className="text-slate-500 hover:bg-slate-100 font-black text-[10px] uppercase tracking-widest border border-slate-200 bg-white px-3 py-2 rounded-lg shadow-sm transition-all"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      title="Desativar cadastro"
                      className="text-red-500 hover:bg-red-50 font-black text-[10px] uppercase tracking-widest border border-red-100 bg-white px-3 py-2 rounded-lg shadow-sm transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-6 flex items-start gap-3">
        <X className="w-4 h-4 text-slate-300 mt-0.5" />
        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
          Cadastros desativados deixam de aparecer nas novas seleções, mas não apagam histórico de colaboradores já registrados.
        </p>
      </div>
    </div>
  )
}
