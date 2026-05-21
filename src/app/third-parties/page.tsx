// responsive: revisado — mobile-first ✓
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type React from "react"
import { Building2, CheckCircle2, DollarSign, Edit3, Handshake, Loader2, Mail, MapPin, Package, Phone, Plus, Search, ShieldAlert, Trash2, X, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/services/api"
import type { DeliveryWithRelations, Employee, ThirdParty, Workplace } from "@/types/database"
import { useAuth } from "@/contexts/AuthContext"
import { BottomSheet } from "@/components/ui/BottomSheet"
import { MobileTableCard } from "@/components/ui/MobileTableCard"

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
          Faca login para acessar o cadastro de terceiros.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[90rem] space-y-5 p-4 pb-24 md:p-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#2563EB]">Tomadores / clientes atendidos</p>
            <h1 className="mt-1 flex items-center gap-3 text-2xl font-black uppercase tracking-tighter text-slate-800">
              <Handshake className="h-7 w-7 text-[#2563EB]" />
              Terceiros
            </h1>
            <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500">
              Cadastre os tomadores para separar obras, custos, entregas e auditoria sem criar outro tenant no sistema.
            </p>
          </div>
          <button
            onClick={openNewThirdParty}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-md shadow-blue-900/15 hover:bg-[#1D4ED8]"
          >
            <Plus className="h-4 w-4" />
            Novo Terceiro
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Building2} label="Cadastrados" value={thirdParties.length} />
          <Metric icon={CheckCircle2} label="Ativos" value={activeCount} />
          <Metric icon={Handshake} label="Colaboradores" value={linkedEmployeesCount} />
          <Metric icon={MapPin} label="Obras Vinculadas" value={linkedWorkplacesCount} />
        </div>
      </section>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(560px,0.82fr)] 2xl:items-start">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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

          <div className="grid grid-cols-1 gap-3 p-3 md:hidden">
            {filteredThirdParties.map((thirdParty) => (
              <MobileTableCard
                key={thirdParty.id}
                title={thirdParty.trade_name || thirdParty.name}
                subtitle={thirdParty.cnpj ? `CNPJ ${thirdParty.cnpj}` : thirdParty.name}
                badge={{
                  label: thirdParty.active ? "Ativo" : "Inativo",
                  variant: thirdParty.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
                }}
                fields={[
                  { label: "Tipo", value: "Terceiro" },
                  { label: "Contato", value: thirdParty.contact_name || "-" },
                  { label: "Telefone", value: thirdParty.phone || "-" },
                  { label: "E-mail", value: thirdParty.email || "-" },
                  { label: "Endereco", value: thirdParty.address || "-" },
                  { label: "Razao social", value: thirdParty.name || "-" },
                ]}
                actions={
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => editThirdParty(thirdParty)} className="min-h-11 rounded-xl border border-slate-200 text-sm font-bold text-slate-600">
                      Editar
                    </button>
                    <button onClick={() => void handleDeactivate(thirdParty)} disabled={!thirdParty.active} className="min-h-11 rounded-xl border border-red-100 text-sm font-bold text-red-600 disabled:opacity-40">
                      Inativar
                    </button>
                  </div>
                }
                expandable
              />
            ))}
            {filteredThirdParties.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm font-bold uppercase tracking-widest text-slate-400">
                Nenhum terceiro encontrado.
              </p>
            )}
          </div>

          <div className="hidden overflow-x-auto md:block">
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

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm 2xl:sticky 2xl:top-4">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between 2xl:flex-col 2xl:items-stretch">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#2563EB]">Cobrança de EPIs</p>
            <h2 className="mt-1 text-base font-black uppercase tracking-tight text-slate-800">Relatório de entregas</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">Cobrança por quantidade x custo unitário.</p>
          </div>
          <select
            value={billingFilter}
            onChange={(event) => setBillingFilter(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-600 outline-none focus:border-[#2563EB]"
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

        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
          <TextMetric icon={Package} label="Itens entregues" value={String(billingItemsCount)} />
          <TextMetric icon={Building2} label="Registros" value={String(thirdPartyDeliveries.length)} />
          <TextMetric icon={DollarSign} label="Total para cobrança" value={formatCurrency(totalBillingValue)} />
        </div>

        {billingSummary.length > 0 && (
          <div className="grid gap-3 border-b border-slate-100 p-4">
            {billingSummary.map((summary) => (
              <div key={summary.thirdParty.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-sm font-black uppercase tracking-tight text-slate-800">{summary.thirdParty.trade_name || summary.thirdParty.name}</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-black text-slate-900">{summary.items}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Itens</p>
                  </div>
                  <div>
                    <p className="text-lg font-black text-slate-900">{summary.employees.size}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Pessoas</p>
                  </div>
                  <div>
                    <p className="text-sm font-black text-emerald-700">{formatCurrency(summary.value)}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Valor</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 p-4 md:hidden">
          {thirdPartyDeliveries.slice(0, 20).map(({ delivery, thirdPartyId }) => {
            const thirdParty = thirdPartyById.get(thirdPartyId)
            const unitCost = Number(delivery.ppe?.cost || 0)
            const total = Number(delivery.quantity || 0) * unitCost

            return (
              <MobileTableCard
                key={delivery.id}
                title={delivery.employee?.full_name || "Colaborador"}
                subtitle={delivery.ppe?.name || "EPI"}
                badge={{ label: formatCurrency(total), variant: "bg-emerald-50 text-emerald-700" }}
                fields={[
                  { label: "Data", value: new Date(delivery.delivery_date).toLocaleDateString("pt-BR") },
                  { label: "Terceiro", value: thirdParty?.trade_name || thirdParty?.name || "Terceiro" },
                  { label: "CA", value: delivery.ppe?.ca_number || "N/A" },
                  { label: "Qtd", value: String(delivery.quantity || 0) },
                  { label: "Custo unit.", value: formatCurrency(unitCost) },
                  { label: "CPF", value: delivery.employee?.cpf || "-" },
                ]}
                expandable
              />
            )
          })}
          {thirdPartyDeliveries.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm font-bold uppercase tracking-widest text-slate-400">
              Nenhuma entrega vinculada a terceiros.
            </p>
          )}
        </div>

        <div className="hidden md:block">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Últimas entregas vinculadas</p>
          </div>
          <div className="grid gap-3 p-4">
            {thirdPartyDeliveries.slice(0, 80).map(({ delivery, thirdPartyId }) => {
              const thirdParty = thirdPartyById.get(thirdPartyId)
              const unitCost = Number(delivery.ppe?.cost || 0)
              const total = Number(delivery.quantity || 0) * unitCost

              return (
                <article key={delivery.id} className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(160px,0.8fr)_minmax(130px,0.55fr)] lg:items-center">
                    <div className="min-w-0">
                      <p className="text-sm font-black uppercase leading-snug text-slate-800">
                        {delivery.employee?.full_name || "Colaborador"}
                      </p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {delivery.ppe?.name || "EPI"} · CA {delivery.ppe?.ca_number || "N/A"}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Terceiro / data</p>
                      <p className="mt-1 text-xs font-black uppercase leading-snug text-slate-700">
                        {thirdParty?.trade_name || thirdParty?.name || "Terceiro"}
                      </p>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {new Date(delivery.delivery_date).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-white p-2 text-center lg:grid-cols-1 lg:text-right">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Qtd</p>
                        <p className="text-xs font-black text-slate-800">{delivery.quantity}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Unit.</p>
                        <p className="text-xs font-bold text-slate-600">{formatCurrency(unitCost)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total</p>
                        <p className="text-sm font-black text-emerald-700">{formatCurrency(total)}</p>
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
            {thirdPartyDeliveries.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold uppercase tracking-widest text-slate-400">
                Nenhuma entrega vinculada a terceiros.
              </div>
            )}
          </div>
        </div>
      </section>
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

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <Icon className="h-4 w-4 text-[#2563EB]" />
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    </div>
  )
}

function TextMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <Icon className="h-4 w-4 text-[#2563EB]" />
      <p className="mt-2 text-lg font-black text-slate-900">{value}</p>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    </div>
  )
}
