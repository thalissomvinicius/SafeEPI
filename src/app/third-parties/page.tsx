// responsive: revisado — mobile-first ✓
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type React from "react"
import { Building2, CheckCircle2, DollarSign, Edit3, HardHat, Handshake, Loader2, Mail, MapPin, Package, Phone, Plus, Search, ShieldAlert, Trash2, X, type LucideIcon } from "lucide-react"
import { toast } from "@/lib/toast"
import { api } from "@/services/api"
import type { DeliveryWithRelations, Employee, ThirdParty, Workplace } from "@/types/database"
import { useAuth } from "@/contexts/AuthContext"
import { BottomSheet } from "@/components/ui/BottomSheet"
import { LoadingState } from "@/components/ui/LoadingState"

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

const formatCurrency = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

export default function ThirdPartiesPage() {
  const { user, loading: authLoading } = useAuth()
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [deliveries, setDeliveries] = useState<DeliveryWithRelations[]>([])
  const [form, setForm] = useState<ThirdPartyForm>(emptyForm)
  const [searchTerm, setSearchTerm] = useState("")
  const [billingFilter, setBillingFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)

  const hasAccess = Boolean(user)

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
  const linkedEmployeesCount = employees.filter((employee) => employee.third_party_id).length

  const thirdPartyById = useMemo(() => new Map(thirdParties.map((thirdParty) => [thirdParty.id, thirdParty])), [thirdParties])
  const employeeThirdPartyById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee.third_party_id || null])), [employees])
  const workplaceThirdPartyById = useMemo(() => new Map(workplaces.map((workplace) => [workplace.id, workplace.third_party_id || null])), [workplaces])

  const getDeliveryThirdPartyId = useCallback((delivery: DeliveryWithRelations) =>
    delivery.third_party_id ||
    delivery.employee?.third_party_id ||
    delivery.workplace?.third_party_id ||
    employeeThirdPartyById.get(delivery.employee_id) ||
    workplaceThirdPartyById.get(delivery.workplace_id || "") ||
    null,
  [employeeThirdPartyById, workplaceThirdPartyById])

  const thirdPartyDeliveries = useMemo(() =>
    deliveries
      .map((delivery) => ({ delivery, thirdPartyId: getDeliveryThirdPartyId(delivery) }))
      .filter((item): item is { delivery: DeliveryWithRelations; thirdPartyId: string } => Boolean(item.thirdPartyId))
      .filter((item) => billingFilter === "all" || item.thirdPartyId === billingFilter),
  [billingFilter, deliveries, getDeliveryThirdPartyId])

  const totalBillingValue = thirdPartyDeliveries.reduce((acc, item) =>
    acc + Number(item.delivery.quantity || 0) * Number(item.delivery.ppe?.cost || 0),
  0)
  const billingItemsCount = thirdPartyDeliveries.reduce((acc, item) => acc + Number(item.delivery.quantity || 0), 0)
  const latestThirdPartyDeliveries = thirdPartyDeliveries.slice(0, 8)

  const billingSummary = useMemo(() => {
    const summary = new Map<string, { thirdParty: ThirdParty; deliveries: number; items: number; value: number; employees: Set<string> }>()

    for (const item of thirdPartyDeliveries) {
      const thirdParty = thirdPartyById.get(item.thirdPartyId)
      if (!thirdParty) continue

      const current = summary.get(item.thirdPartyId) || {
        thirdParty,
        deliveries: 0,
        items: 0,
        value: 0,
        employees: new Set<string>(),
      }
      current.deliveries += 1
      current.items += Number(item.delivery.quantity || 0)
      current.value += Number(item.delivery.quantity || 0) * Number(item.delivery.ppe?.cost || 0)
      current.employees.add(item.delivery.employee_id)
      summary.set(item.thirdPartyId, current)
    }

    return Array.from(summary.values()).sort((a, b) => b.value - a.value)
  }, [thirdPartyById, thirdPartyDeliveries])

  const loadData = useCallback(async () => {
    if (!hasAccess) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const [thirdPartyData, workplaceData, employeeData, deliveryData] = await Promise.all([
        api.getThirdParties(),
        api.getWorkplaces(),
        api.getEmployees(),
        api.getDeliveries(),
      ])
      setThirdParties(thirdPartyData)
      setWorkplaces(workplaceData)
      setEmployees(employeeData)
      setDeliveries(deliveryData)
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

  const clearForm = () => setForm({ ...emptyForm })

  const openNewThirdParty = () => {
    setForm({ ...emptyForm })
    setIsFormOpen(true)
  }

  const closeForm = () => {
    if (submitting) return
    setIsFormOpen(false)
    setForm({ ...emptyForm })
  }

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
    setIsFormOpen(true)
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

      await loadData()
      setIsFormOpen(false)
      clearForm()
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
      <LoadingState
        variant="page"
        label="Carregando terceiros"
        detail="Sincronizando tomadores, colaboradores e entregas vinculadas."
      />
    )
  }

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-40 text-center">
        <ShieldAlert className="mb-4 h-14 w-14 text-slate-300" />
        <h2 className="text-xl font-black uppercase tracking-tighter text-slate-700">Aba Terceiros Bloqueada</h2>
        <p className="mt-2 max-w-md text-sm font-medium text-slate-400">
          Faca login para acessar o cadastro de terceiros.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[90rem] space-y-5 p-4 pb-24 md:p-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-red-700">Tomadores / clientes atendidos</p>
            <h1 className="mt-1 flex items-center gap-3 text-2xl font-black uppercase tracking-tighter text-slate-900">
              <Handshake className="h-7 w-7 text-red-700" />
              Terceiros
            </h1>
            <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500">
              Cadastre os tomadores para separar obras, custos, entregas e auditoria sem criar outro tenant no sistema.
            </p>
          </div>
          <button
            onClick={openNewThirdParty}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-red-900/20 hover:bg-red-800 sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Novo terceiro
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Building2} label="Cadastrados" value={thirdParties.length} tone="neutral" />
          <Metric icon={CheckCircle2} label="Ativos" value={activeCount} tone="success" />
          <Metric icon={HardHat} label="Colaboradores" value={linkedEmployeesCount} tone="info" />
          <Metric icon={MapPin} label="Obras vinculadas" value={linkedWorkplacesCount} tone="warning" />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cadastro operacional</p>
              <h2 className="mt-1 text-base font-black uppercase tracking-tight text-slate-800">Terceiros cadastrados</h2>
            </div>
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar por nome, CNPJ ou contato..."
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-11 pr-4 text-sm font-bold outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {filteredThirdParties.map((thirdParty) => (
              <article
                key={thirdParty.id}
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50/70 sm:flex-row sm:items-center"
              >
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-black text-white shadow-sm ${getAvatarTone(thirdParty.id)}`}>
                  {getInitials(thirdParty.trade_name || thirdParty.name)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="min-w-0 truncate text-sm font-medium uppercase tracking-tight text-slate-900">
                      {thirdParty.trade_name || thirdParty.name}
                    </p>
                    <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${
                      thirdParty.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}>
                      {thirdParty.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>

                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500">
                    <span className="truncate">{thirdParty.cnpj ? `CNPJ ${thirdParty.cnpj}` : thirdParty.name}</span>
                    <span className="hidden text-slate-300 sm:inline">•</span>
                    <span className="truncate">{thirdParty.contact_name || thirdParty.email || thirdParty.phone || "Sem contato"}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                  <button
                    onClick={() => editThirdParty(thirdParty)}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-700 transition-colors hover:bg-red-100 md:min-h-[30px] md:min-w-[30px]"
                    title="Editar terceiro"
                    aria-label="Editar terceiro"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => void handleDeactivate(thirdParty)}
                    disabled={!thirdParty.active}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-red-100 bg-white text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35 md:min-h-[30px] md:min-w-[30px]"
                    title="Inativar terceiro"
                    aria-label="Inativar terceiro"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            ))}
            {filteredThirdParties.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm font-bold uppercase tracking-widest text-slate-400">
                Nenhum terceiro encontrado.
              </p>
            )}
          </div>

          <div className="hidden">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">Terceiro</th>
                  <th className="px-4 py-3">Contato</th>
                  <th className="px-4 py-3">Endereco</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredThirdParties.map((thirdParty) => (
                  <tr key={thirdParty.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <p className="font-black uppercase tracking-tight text-slate-800">{thirdParty.trade_name || thirdParty.name}</p>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">{thirdParty.name}</p>
                      {thirdParty.cnpj && <p className="mt-0.5 text-[10px] font-bold text-slate-500">CNPJ {thirdParty.cnpj}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-500">
                      {thirdParty.contact_name && <p className="text-slate-700">{thirdParty.contact_name}</p>}
                      {thirdParty.email && <p className="mt-1 flex items-center gap-1"><Mail className="h-3 w-3" /> {thirdParty.email}</p>}
                      {thirdParty.phone && <p className="mt-1 flex items-center gap-1"><Phone className="h-3 w-3" /> {thirdParty.phone}</p>}
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-xs font-medium text-slate-500">{thirdParty.address || "-"}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${
                        thirdParty.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}>
                        {thirdParty.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
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
                    <td colSpan={5} className="px-4 py-10 text-center text-sm font-bold uppercase tracking-widest text-slate-400">
                      Nenhum terceiro encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="grid min-w-0 gap-5 lg:w-[380px]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-red-700">Cobrança de EPIs</p>
            <h2 className="mt-1 text-base font-black uppercase tracking-tight text-slate-900">Relatório de entregas</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">Cobrança por quantidade x custo unitário.</p>
          </div>
          <select
            value={billingFilter}
            onChange={(event) => setBillingFilter(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-red-200 bg-slate-50 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-600 outline-none focus:border-red-700"
            title="Filtrar relatório por terceiro"
          >
            <option value="all">Todos os terceiros</option>
            {thirdParties.map((thirdParty) => (
              <option key={thirdParty.id} value={thirdParty.id}>
                {thirdParty.trade_name || thirdParty.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <TextMetric icon={Package} label="Itens" value={String(billingItemsCount)} />
          <TextMetric icon={Building2} label="Registros" value={String(thirdPartyDeliveries.length)} />
          <TextMetric icon={DollarSign} label="Total" value={formatCurrency(totalBillingValue)} />
        </div>

        {billingSummary.length > 0 && (
          <div className="mt-4 grid gap-3">
            {billingSummary.map((summary) => (
              <div key={summary.thirdParty.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-black uppercase tracking-tight text-slate-800">{summary.thirdParty.trade_name || summary.thirdParty.name}</p>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-700">
                    {formatCurrency(summary.value)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <CompactNumber label="Itens" value={String(summary.items)} />
                  <CompactNumber label="Pessoas" value={String(summary.employees.size)} />
                  <CompactNumber label="Entregas" value={String(summary.deliveries)} />
                </div>
              </div>
            ))}
          </div>
        )}

        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">

        <div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Últimas entregas</p>
            <h2 className="mt-1 text-base font-black uppercase tracking-tight text-slate-900">Movimentações vinculadas</h2>
          </div>
          <div className="mt-4 grid gap-3">
            {latestThirdPartyDeliveries.map(({ delivery, thirdPartyId }) => {
              const thirdParty = thirdPartyById.get(thirdPartyId)
              const unitCost = Number(delivery.ppe?.cost || 0)
              const total = Number(delivery.quantity || 0) * unitCost

              return (
                <article key={delivery.id} className="grid grid-cols-[10px_minmax(0,1fr)_auto] gap-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                  <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-red-600" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium uppercase text-slate-900">{delivery.employee?.full_name || "Colaborador"}</p>
                    <p className="mt-0.5 truncate text-xs font-bold text-slate-600">{delivery.ppe?.name || "EPI"}</p>
                    <p className="mt-0.5 truncate text-xs font-medium text-slate-400">
                      {thirdParty?.trade_name || thirdParty?.name || "Terceiro"} · {new Date(delivery.delivery_date).toLocaleDateString("pt-BR")}
                    </p>
                    </div>
                  <p className="self-center text-sm font-black text-emerald-700">{formatCurrency(total)}</p>
                </article>
              )
            })}
            {latestThirdPartyDeliveries.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold uppercase tracking-widest text-slate-400">
                Nenhuma entrega vinculada a terceiros.
              </div>
            )}
          </div>
        </div>
      </section>
      </aside>
      </div>


      <BottomSheet
        open={isFormOpen}
        onClose={closeForm}
        className="md:max-w-4xl"
        contentClassName="p-0"
      >
          <form
            onSubmit={handleSubmit}
            className="flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl md:my-3"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#2563EB]">Cadastro de terceiro</p>
                <h2 className="mt-1 text-xl font-black uppercase tracking-tight text-slate-900">
                  {form.id ? "Editar terceiro" : "Novo terceiro"}
                </h2>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  {form.id ? "Atualize os dados do tomador selecionado." : "Preencha os dados do tomador para vincular obras e colaboradores."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                disabled={submitting}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
                title="Fechar cadastro"
                aria-label="Fechar cadastro"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid min-h-0 gap-3 overflow-y-auto p-4 md:grid-cols-2 sm:p-5">
              <label className="space-y-2 sm:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Razao social</span>
                <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Razao social" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition-colors focus:border-[#2563EB] focus:bg-white" />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nome fantasia</span>
                <input value={form.trade_name} onChange={(event) => setForm({ ...form, trade_name: event.target.value })} placeholder="Nome fantasia" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition-colors focus:border-[#2563EB] focus:bg-white" />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">CNPJ</span>
                <input inputMode="numeric" value={form.cnpj} onChange={(event) => setForm({ ...form, cnpj: event.target.value })} placeholder="00.000.000/0000-00" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition-colors focus:border-[#2563EB] focus:bg-white" />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contato responsavel</span>
                <input value={form.contact_name} onChange={(event) => setForm({ ...form, contact_name: event.target.value })} placeholder="Nome do responsavel" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition-colors focus:border-[#2563EB] focus:bg-white" />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Telefone</span>
                <input inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Telefone" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition-colors focus:border-[#2563EB] focus:bg-white" />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">E-mail</span>
                <input type="email" inputMode="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="E-mail" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition-colors focus:border-[#2563EB] focus:bg-white" />
              </label>
              <label className="space-y-2 sm:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Endereco</span>
                <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Endereco completo" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition-colors focus:border-[#2563EB] focus:bg-white" />
              </label>
              <label className="space-y-2 sm:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Observacoes</span>
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Observacoes contratuais ou operacionais" rows={3} className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none transition-colors focus:border-[#2563EB] focus:bg-white" />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:col-span-2">
                <span className="text-xs font-black uppercase tracking-widest text-slate-700">Terceiro ativo</span>
                <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="h-5 w-5 accent-[#2563EB]" />
              </label>
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-100 bg-white px-4 py-3 md:flex-row md:justify-end sm:px-5">
              <button type="button" onClick={closeForm} disabled={submitting} className="min-h-11 w-full rounded-xl border border-slate-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50 md:w-auto">
                Cancelar
              </button>
              <button disabled={submitting} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-6 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-blue-900/15 transition-colors hover:bg-[#1D4ED8] disabled:opacity-60 md:w-auto">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {form.id ? "Salvar alteracoes" : "Salvar terceiro"}
              </button>
            </div>
          </form>
      </BottomSheet>
    </div>
  )
}

const metricTones = {
  neutral: "border-slate-100 bg-slate-50 text-slate-700",
  success: "border-emerald-100 bg-emerald-50 text-emerald-700",
  info: "border-blue-100 bg-blue-50 text-blue-700",
  warning: "border-amber-100 bg-amber-50 text-amber-700",
}

function Metric({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: keyof typeof metricTones }) {
  return (
    <div className={`rounded-xl border p-3 ${metricTones[tone]}`}>
      <Icon className="h-4 w-4" />
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
    </div>
  )
}

function TextMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 p-2.5">
      <Icon className="h-4 w-4 text-red-700" />
      <p className="mt-2 truncate text-base font-black text-slate-900">{value}</p>
      <p className="truncate text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    </div>
  )
}

function CompactNumber({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-2 py-2">
      <p className="text-base font-black text-slate-900">{value}</p>
      <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    </div>
  )
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TP"
}

function getAvatarTone(id: string) {
  const tones = [
    "bg-red-700",
    "bg-slate-700",
    "bg-blue-700",
    "bg-emerald-700",
    "bg-amber-700",
    "bg-cyan-700",
  ]
  const index = Array.from(id).reduce((acc, char) => acc + char.charCodeAt(0), 0) % tones.length
  return tones[index]
}
