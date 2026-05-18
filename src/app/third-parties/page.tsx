"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type React from "react"
import { Building2, CheckCircle2, Edit3, Handshake, Loader2, Mail, MapPin, Phone, Plus, Search, ShieldAlert, Trash2, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/services/api"
import type { ThirdParty, Workplace } from "@/types/database"
import { useAuth } from "@/contexts/AuthContext"

type ThirdPartyForm = {
  id?: string
  name: string
  trade_name: string
  cnpj: string
  contact_name: string
  phone: string
  email: string
  address: string
  notes: string
  active: boolean
}

const emptyForm: ThirdPartyForm = {
  name: "",
  trade_name: "",
  cnpj: "",
  contact_name: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  active: true,
}

export default function ThirdPartiesPage() {
  const { user, loading: authLoading } = useAuth()
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [form, setForm] = useState<ThirdPartyForm>(emptyForm)
  const [searchTerm, setSearchTerm] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const hasAccess = user?.role === "MASTER" || user?.company?.third_parties_enabled === true

  const filteredThirdParties = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return thirdParties

    return thirdParties.filter((thirdParty) =>
      [
        thirdParty.name,
        thirdParty.trade_name,
        thirdParty.cnpj,
        thirdParty.contact_name,
        thirdParty.email,
        thirdParty.phone,
        thirdParty.address,
      ].some((value) => value?.toLowerCase().includes(term))
    )
  }, [thirdParties, searchTerm])

  const activeCount = thirdParties.filter((thirdParty) => thirdParty.active).length
  const linkedWorkplacesCount = workplaces.filter((workplace) => workplace.third_party_id).length

  const loadData = useCallback(async () => {
    if (!hasAccess) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const [thirdPartyData, workplaceData] = await Promise.all([
        api.getThirdParties(),
        api.getWorkplaces(),
      ])
      setThirdParties(thirdPartyData)
      setWorkplaces(workplaceData)
    } catch (error) {
      console.error("Erro ao carregar terceiros:", error)
      const message = error instanceof Error ? error.message : "Nao foi possivel carregar terceiros."
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [hasAccess])

  useEffect(() => {
    if (authLoading) return
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [authLoading, hasAccess, loadData])

  const clearForm = () => setForm(emptyForm)

  const editThirdParty = (thirdParty: ThirdParty) => {
    setForm({
      id: thirdParty.id,
      name: thirdParty.name || "",
      trade_name: thirdParty.trade_name || "",
      cnpj: thirdParty.cnpj || "",
      contact_name: thirdParty.contact_name || "",
      phone: thirdParty.phone || "",
      email: thirdParty.email || "",
      address: thirdParty.address || "",
      notes: thirdParty.notes || "",
      active: thirdParty.active,
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      toast.error("Informe a razao social do terceiro.")
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        name: form.name.trim(),
        trade_name: form.trade_name.trim() || null,
        cnpj: form.cnpj.trim() || null,
        contact_name: form.contact_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        active: form.active,
      }

      if (form.id) {
        await api.updateThirdParty(form.id, payload)
        toast.success("Terceiro atualizado.")
      } else {
        await api.addThirdParty(payload)
        toast.success("Terceiro cadastrado.")
      }

      clearForm()
      await loadData()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao salvar terceiro."
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeactivate = async (thirdParty: ThirdParty) => {
    if (!window.confirm(`Inativar ${thirdParty.trade_name || thirdParty.name}?`)) return

    try {
      await api.deleteThirdParty(thirdParty.id)
      toast.success("Terceiro inativado.")
      await loadData()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao inativar terceiro."
      toast.error(message)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="mb-4 h-10 w-10 animate-spin text-[#2563EB]" />
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Carregando terceiros...</p>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-40 text-center">
        <ShieldAlert className="mb-4 h-14 w-14 text-slate-300" />
        <h2 className="text-xl font-black uppercase tracking-tighter text-slate-700">Aba Terceiros Bloqueada</h2>
        <p className="mt-2 max-w-md text-sm font-medium text-slate-400">
          O acesso a terceiros precisa ser liberado no painel Master para esta empresa.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 pb-24 md:p-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#2563EB]">Tomadores / clientes atendidos</p>
            <h1 className="mt-1 flex items-center gap-3 text-2xl font-black uppercase tracking-tighter text-slate-800">
              <Handshake className="h-7 w-7 text-[#2563EB]" />
              Terceiros
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-slate-500">
              Cadastre os tomadores para separar obras, custos, entregas e auditoria sem criar outro tenant no sistema.
            </p>
          </div>
          <button
            onClick={clearForm}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-md hover:bg-[#1D4ED8]"
          >
            <Plus className="h-4 w-4" />
            Novo Terceiro
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <Metric icon={Building2} label="Cadastrados" value={thirdParties.length} />
          <Metric icon={CheckCircle2} label="Ativos" value={activeCount} />
          <Metric icon={MapPin} label="Obras Vinculadas" value={linkedWorkplacesCount} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <div className="relative max-w-md">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar por nome, CNPJ ou contato..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                <tr>
                  <th className="px-5 py-4">Terceiro</th>
                  <th className="px-5 py-4">Contato</th>
                  <th className="px-5 py-4">Endereço</th>
                  <th className="px-5 py-4 text-center">Status</th>
                  <th className="px-5 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredThirdParties.map((thirdParty) => (
                  <tr key={thirdParty.id} className="hover:bg-slate-50/80">
                    <td className="px-5 py-4">
                      <p className="font-black uppercase tracking-tight text-slate-800">{thirdParty.trade_name || thirdParty.name}</p>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{thirdParty.name}</p>
                      {thirdParty.cnpj && <p className="mt-1 text-[10px] font-bold text-slate-500">CNPJ {thirdParty.cnpj}</p>}
                    </td>
                    <td className="px-5 py-4 text-xs font-bold text-slate-500">
                      {thirdParty.contact_name && <p className="text-slate-700">{thirdParty.contact_name}</p>}
                      {thirdParty.email && <p className="mt-1 flex items-center gap-1"><Mail className="h-3 w-3" /> {thirdParty.email}</p>}
                      {thirdParty.phone && <p className="mt-1 flex items-center gap-1"><Phone className="h-3 w-3" /> {thirdParty.phone}</p>}
                    </td>
                    <td className="max-w-xs px-5 py-4 text-xs font-medium text-slate-500">{thirdParty.address || "-"}</td>
                    <td className="px-5 py-4 text-center">
                      <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${
                        thirdParty.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}>
                        {thirdParty.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => editThirdParty(thirdParty)}
                          className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-[#2563EB]"
                          title="Editar terceiro"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        {thirdParty.active && (
                          <button
                            onClick={() => void handleDeactivate(thirdParty)}
                            className="rounded-xl border border-red-100 p-2 text-red-500 hover:bg-red-50"
                            title="Inativar terceiro"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredThirdParties.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center text-sm font-bold uppercase tracking-widest text-slate-400">
                      Nenhum terceiro encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-24 xl:self-start">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#2563EB]">Cadastro</p>
            <h2 className="text-base font-black uppercase tracking-tight text-slate-800">
              {form.id ? "Editar terceiro" : "Novo terceiro"}
            </h2>
          </div>

          <div className="grid gap-3">
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Razão social" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" />
            <input value={form.trade_name} onChange={(event) => setForm({ ...form, trade_name: event.target.value })} placeholder="Nome fantasia" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" />
            <input value={form.cnpj} onChange={(event) => setForm({ ...form, cnpj: event.target.value })} placeholder="CNPJ" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" />
            <input value={form.contact_name} onChange={(event) => setForm({ ...form, contact_name: event.target.value })} placeholder="Contato responsável" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" />
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Telefone" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" />
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="E-mail" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" />
            </div>
            <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Endereço" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" />
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Observações contratuais ou operacionais" rows={3} className="resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" />
            <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="text-xs font-black uppercase tracking-widest text-slate-700">Terceiro ativo</span>
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="h-5 w-5 accent-[#2563EB]" />
            </label>
          </div>

          <button disabled={submitting} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-[#1D4ED8] disabled:opacity-60">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Salvar Terceiro
          </button>
          {form.id && (
            <button type="button" onClick={clearForm} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50">
              Cancelar edição
            </button>
          )}
        </form>
      </div>
    </div>
  )
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
      <Icon className="h-5 w-5 text-[#2563EB]" />
      <p className="mt-3 text-2xl font-black text-slate-900">{value}</p>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    </div>
  )
}
