"use client"

import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { useRouter } from "next/navigation"
import { Building2, CheckCircle2, Loader2, Mail, Pencil, Phone, Plus, Shield, UserCog, Users, XCircle } from "lucide-react"
import { toast } from "sonner"
import { api, type CompanyWithCounts } from "@/services/api"
import type { Profile } from "@/types/database"
import { useAuth } from "@/contexts/AuthContext"

type CompanyForm = {
  id?: string
  name: string
  trade_name: string
  cnpj: string
  email: string
  phone: string
  address: string
  primary_color: string
  active: boolean
}

type UserForm = {
  full_name: string
  email: string
  password: string
  role: "ADMIN" | "ALMOXARIFE" | "DIRETORIA"
}

const emptyCompanyForm: CompanyForm = {
  name: "",
  trade_name: "",
  cnpj: "",
  email: "",
  phone: "",
  address: "",
  primary_color: "#2563EB",
  active: true,
}

const emptyUserForm: UserForm = {
  full_name: "",
  email: "",
  password: "",
  role: "ADMIN",
}

export default function CompaniesPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [companies, setCompanies] = useState<CompanyWithCounts[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("")
  const [companyForm, setCompanyForm] = useState<CompanyForm>(emptyCompanyForm)
  const [userForm, setUserForm] = useState<UserForm>(emptyUserForm)
  const [companyUsers, setCompanyUsers] = useState<(Profile & { email: string; created_at: string; last_sign_in_at: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [usersLoading, setUsersLoading] = useState(false)
  const [submittingCompany, setSubmittingCompany] = useState(false)
  const [submittingUser, setSubmittingUser] = useState(false)

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  )

  useEffect(() => {
    if (!authLoading && user && user.role !== "MASTER") {
      router.push("/")
    }
  }, [authLoading, router, user])

  const loadCompanies = async () => {
    try {
      setLoading(true)
      const data = await api.getCompanies()
      setCompanies(data)
      setSelectedCompanyId((current) => current || data[0]?.id || "")
    } catch (error) {
      console.error("Erro ao carregar empresas:", error)
      toast.error("Nao foi possivel carregar as empresas.")
    } finally {
      setLoading(false)
    }
  }

  const loadCompanyUsers = async (companyId: string) => {
    if (!companyId) return

    try {
      setUsersLoading(true)
      const data = await api.getUsers(companyId)
      setCompanyUsers(data)
    } catch (error) {
      console.error("Erro ao carregar usuarios da empresa:", error)
      toast.error("Nao foi possivel carregar os usuarios da empresa.")
    } finally {
      setUsersLoading(false)
    }
  }

  useEffect(() => {
    if (user?.role === "MASTER") {
      const timer = window.setTimeout(() => {
        void loadCompanies()
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [user])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedCompanyId) {
        void loadCompanyUsers(selectedCompanyId)
      } else {
        setCompanyUsers([])
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [selectedCompanyId])

  const editCompany = (company: CompanyWithCounts) => {
    setCompanyForm({
      id: company.id,
      name: company.name || "",
      trade_name: company.trade_name || "",
      cnpj: company.cnpj || "",
      email: company.email || "",
      phone: company.phone || "",
      address: company.address || "",
      primary_color: company.primary_color || "#2563EB",
      active: company.active,
    })
  }

  const clearCompanyForm = () => {
    setCompanyForm(emptyCompanyForm)
  }

  const handleCompanySubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmittingCompany(true)

    try {
      if (companyForm.id) {
        await api.updateCompany({ ...companyForm, id: companyForm.id })
        toast.success("Empresa atualizada com sucesso.")
      } else {
        const created = await api.createCompany(companyForm)
        toast.success("Empresa criada com sucesso.")
        if (created?.id) setSelectedCompanyId(created.id)
      }

      clearCompanyForm()
      await loadCompanies()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Erro ao salvar empresa."
      toast.error(message)
    } finally {
      setSubmittingCompany(false)
    }
  }

  const handleUserSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!selectedCompanyId) {
      toast.error("Selecione uma empresa antes de criar o usuario.")
      return
    }

    setSubmittingUser(true)
    try {
      await api.createUser({ ...userForm, company_id: selectedCompanyId })
      toast.success("Usuario criado e vinculado a empresa.")
      setUserForm(emptyUserForm)
      await loadCompanyUsers(selectedCompanyId)
      await loadCompanies()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Erro ao criar usuario."
      toast.error(message)
    } finally {
      setSubmittingUser(false)
    }
  }

  if (authLoading || (user && user.role !== "MASTER")) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="w-10 h-10 animate-spin text-[#2563EB] mb-4" />
        <p className="font-bold text-slate-400 uppercase tracking-widest text-xs italic">Validando acesso master...</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-[#2563EB]">Painel Master</p>
          <h1 className="mt-1 flex items-center gap-3 text-2xl md:text-4xl font-black tracking-tighter text-slate-800 uppercase">
            <Building2 className="h-8 w-8 text-[#2563EB]" />
            Empresas Clientes
          </h1>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-slate-500">
            Controle central de clientes, acessos administrativos e separacao de dados por empresa.
          </p>
        </div>

        <button
          onClick={clearCompanyForm}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-md transition-colors hover:bg-[#1D4ED8]"
        >
          <Plus className="h-4 w-4" />
          Nova Empresa
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
        <section className="space-y-4">
          {loading ? (
            <div className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-100 bg-white">
              <Loader2 className="h-8 w-8 animate-spin text-[#2563EB]" />
            </div>
          ) : companies.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-10 text-center">
              <Building2 className="mx-auto h-10 w-10 text-slate-300" />
              <h3 className="mt-4 text-sm font-black uppercase tracking-widest text-slate-700">Nenhuma empresa cadastrada</h3>
              <p className="mt-2 text-sm font-medium text-slate-500">Crie o primeiro cliente para iniciar a separacao dos ambientes.</p>
            </div>
          ) : (
            companies.map((company) => {
              const active = selectedCompanyId === company.id
              return (
                <button
                  key={company.id}
                  onClick={() => setSelectedCompanyId(company.id)}
                  className={`w-full rounded-2xl border p-5 text-left shadow-sm transition-all ${
                    active ? "border-[#2563EB]/30 bg-blue-50/40" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-lg font-black tracking-tight text-slate-800">{company.trade_name || company.name}</h2>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${
                          company.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}>
                          {company.active ? "Ativa" : "Inativa"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">{company.name}</p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500">
                        {company.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{company.email}</span>}
                        {company.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{company.phone}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="rounded-xl bg-white px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-500 shadow-sm">
                        {company.employees_count || 0} colab.
                      </span>
                      <span className="rounded-xl bg-white px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-500 shadow-sm">
                        {company.users_count || 0} users
                      </span>
                      <span
                        onClick={(event) => {
                          event.stopPropagation()
                          editCompany(company)
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-[#2563EB]"
                        title="Editar empresa"
                      >
                        <Pencil className="h-4 w-4" />
                      </span>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </section>

        <aside className="space-y-6">
          <form onSubmit={handleCompanySubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">
                {companyForm.id ? "Editar Empresa" : "Cadastrar Empresa"}
              </h2>
              {companyForm.id && (
                <button type="button" onClick={clearCompanyForm} className="text-slate-400 hover:text-slate-700" title="Cancelar edicao">
                  <XCircle className="h-5 w-5" />
                </button>
              )}
            </div>

            <div className="grid gap-3">
              <input className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" required placeholder="Razao social" value={companyForm.name} onChange={(event) => setCompanyForm({ ...companyForm, name: event.target.value })} />
              <input className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" placeholder="Nome fantasia" value={companyForm.trade_name} onChange={(event) => setCompanyForm({ ...companyForm, trade_name: event.target.value })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" placeholder="CNPJ" value={companyForm.cnpj} onChange={(event) => setCompanyForm({ ...companyForm, cnpj: event.target.value })} />
                <input className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" placeholder="Telefone" value={companyForm.phone} onChange={(event) => setCompanyForm({ ...companyForm, phone: event.target.value })} />
              </div>
              <input className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" type="email" placeholder="E-mail comercial" value={companyForm.email} onChange={(event) => setCompanyForm({ ...companyForm, email: event.target.value })} />
              <input className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]" placeholder="Endereco" value={companyForm.address} onChange={(event) => setCompanyForm({ ...companyForm, address: event.target.value })} />
              <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500">
                Empresa ativa
                <input type="checkbox" checked={companyForm.active} onChange={(event) => setCompanyForm({ ...companyForm, active: event.target.checked })} className="h-5 w-5 accent-[#2563EB]" />
              </label>
            </div>

            <button disabled={submittingCompany} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60">
              {submittingCompany ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Salvar Empresa
            </button>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Empresa selecionada</p>
              <h2 className="mt-1 truncate text-lg font-black tracking-tight text-slate-800">{selectedCompany?.trade_name || selectedCompany?.name || "Selecione uma empresa"}</h2>
            </div>

            <form onSubmit={handleUserSubmit} className="grid gap-3">
              <input disabled={!selectedCompanyId} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB] disabled:opacity-50" required placeholder="Nome do administrador" value={userForm.full_name} onChange={(event) => setUserForm({ ...userForm, full_name: event.target.value })} />
              <input disabled={!selectedCompanyId} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB] disabled:opacity-50" required type="email" placeholder="E-mail de acesso" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
              <div className="grid gap-3 sm:grid-cols-[1fr_0.85fr]">
                <input disabled={!selectedCompanyId} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB] disabled:opacity-50" required minLength={6} type="password" placeholder="Senha provisoria" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} />
                <select disabled={!selectedCompanyId} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-widest outline-none focus:border-[#2563EB] disabled:opacity-50" value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value as UserForm["role"] })} title="Nivel de acesso">
                  <option value="ADMIN">Admin</option>
                  <option value="ALMOXARIFE">Almoxarife</option>
                  <option value="DIRETORIA">Diretoria</option>
                </select>
              </div>
              <button disabled={submittingUser || !selectedCompanyId} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-slate-800 disabled:opacity-60">
                {submittingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
                Criar Acesso
              </button>
            </form>

            <div className="mt-6 border-t border-slate-100 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-700">
                  <Users className="h-4 w-4 text-[#2563EB]" />
                  Usuarios
                </h3>
                {usersLoading && <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" />}
              </div>

              <div className="space-y-2">
                {companyUsers.map((companyUser) => (
                  <div key={companyUser.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-800">{companyUser.full_name || "Usuario sem nome"}</p>
                      <p className="truncate text-[11px] font-medium text-slate-500">{companyUser.email}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-[#2563EB]">
                      <Shield className="h-3 w-3" />
                      {companyUser.role}
                    </span>
                  </div>
                ))}

                {!usersLoading && companyUsers.length === 0 && (
                  <p className="rounded-xl bg-slate-50 p-4 text-center text-xs font-bold uppercase tracking-widest text-slate-400">
                    Sem usuarios vinculados
                  </p>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
