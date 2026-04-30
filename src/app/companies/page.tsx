"use client"

import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { useRouter } from "next/navigation"
import {
  Building2,
  CheckCircle2,
  CreditCard,
  FileBadge2,
  GraduationCap,
  ImageIcon,
  Loader2,
  Mail,
  Package,
  Palette,
  Pencil,
  Phone,
  Plus,
  Search,
  Shield,
  ShieldOff,
  UploadCloud,
  UserCog,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react"
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
  logo_url: string
  primary_color: string
  active: boolean
  training_enabled: boolean
  subscription_status: "ACTIVE" | "PAST_DUE" | "SUSPENDED"
  suspended_reason: string
}

type UserForm = {
  full_name: string
  email: string
  password: string
  role: "ADMIN" | "ALMOXARIFE" | "DIRETORIA"
}

const LOGO_WIDTH = 800
const LOGO_HEIGHT = 320

const emptyCompanyForm: CompanyForm = {
  name: "",
  trade_name: "",
  cnpj: "",
  email: "",
  phone: "",
  address: "",
  logo_url: "",
  primary_color: "#2563EB",
  active: true,
  training_enabled: false,
  subscription_status: "ACTIVE",
  suspended_reason: "",
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
  const [selectedCompanyId, setSelectedCompanyId] = useState("")
  const [companyForm, setCompanyForm] = useState<CompanyForm>(emptyCompanyForm)
  const [userForm, setUserForm] = useState<UserForm>(emptyUserForm)
  const [companyUsers, setCompanyUsers] = useState<(Profile & { email: string; created_at: string; last_sign_in_at: string })[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState("")
  const [loading, setLoading] = useState(true)
  const [usersLoading, setUsersLoading] = useState(false)
  const [submittingCompany, setSubmittingCompany] = useState(false)
  const [submittingUser, setSubmittingUser] = useState(false)

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  )

  const filteredCompanies = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return companies

    return companies.filter((company) =>
      [company.name, company.trade_name, company.cnpj, company.email].some((value) =>
        value?.toLowerCase().includes(term)
      )
    )
  }, [companies, searchTerm])

  const totals = useMemo(() => ({
    companies: companies.length,
    activeCompanies: companies.filter((company) => company.active).length,
    employees: companies.reduce((sum, company) => sum + (company.employees_count || 0), 0),
    documents: companies.reduce((sum, company) => sum + (company.deliveries_count || 0), 0),
  }), [companies])

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
    if (user?.role !== "MASTER") return

    const timer = window.setTimeout(() => {
      void loadCompanies()
    }, 0)

    return () => window.clearTimeout(timer)
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

  const clearCompanyForm = () => {
    setCompanyForm(emptyCompanyForm)
    setLogoFile(null)
    setLogoPreview("")
  }

  const editCompany = (company: CompanyWithCounts) => {
    setCompanyForm({
      id: company.id,
      name: company.name || "",
      trade_name: company.trade_name || "",
      cnpj: company.cnpj || "",
      email: company.email || "",
      phone: company.phone || "",
      address: company.address || "",
      logo_url: company.logo_url || "",
      primary_color: company.primary_color || "#2563EB",
      active: company.active,
      training_enabled: company.training_enabled ?? false,
      subscription_status: company.subscription_status || (company.active ? "ACTIVE" : "SUSPENDED"),
      suspended_reason: company.suspended_reason || "",
    })
    setLogoFile(null)
    setLogoPreview(company.logo_url || "")
  }

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const imageUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      const isExpectedSize = image.width === LOGO_WIDTH && image.height === LOGO_HEIGHT
      URL.revokeObjectURL(imageUrl)

      if (!isExpectedSize) {
        toast.error(`Logo fora do padrao. Envie ${LOGO_WIDTH} x ${LOGO_HEIGHT} px. Este arquivo tem ${image.width} x ${image.height} px.`)
        event.target.value = ""
        return
      }

      setLogoFile(file)
      setLogoPreview(URL.createObjectURL(file))
      setCompanyForm((current) => ({ ...current, logo_url: "" }))
    }

    image.onerror = () => {
      URL.revokeObjectURL(imageUrl)
      toast.error("Nao foi possivel ler a imagem enviada.")
      event.target.value = ""
    }

    image.src = imageUrl
  }

  const handleCompanySubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmittingCompany(true)

    try {
      let savedCompanyId = companyForm.id || ""

      if (companyForm.id) {
        const updated = await api.updateCompany({
          ...companyForm,
          active: companyForm.subscription_status !== "SUSPENDED" && companyForm.active,
          id: companyForm.id,
        })
        savedCompanyId = updated?.id || companyForm.id
        toast.success("Empresa atualizada com sucesso.")
      } else {
        const created = await api.createCompany({
          ...companyForm,
          active: companyForm.subscription_status !== "SUSPENDED" && companyForm.active,
        })
        savedCompanyId = created?.id || ""
        if (created?.id) setSelectedCompanyId(created.id)
        toast.success("Empresa criada com sucesso.")
      }

      if (logoFile && savedCompanyId) {
        await api.uploadCompanyLogo(savedCompanyId, logoFile)
        toast.success("Logo da empresa enviada.")
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
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#2563EB]">Painel Master</p>
            <h1 className="mt-1 flex items-center gap-3 text-2xl md:text-4xl font-black tracking-tighter text-slate-800 uppercase">
              <Building2 className="h-8 w-8 text-[#2563EB]" />
              Empresas Clientes
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-slate-500">
              Controle central de clientes, acessos, marca visual e separacao de dados por empresa.
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

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <Metric icon={Building2} label="Empresas" value={totals.companies} />
          <Metric icon={CheckCircle2} label="Ativas" value={totals.activeCompanies} />
          <Metric icon={Users} label="Colaboradores" value={totals.employees} />
          <Metric icon={FileBadge2} label="Evidencias" value={totals.documents} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.9fr]">
        <section className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Carteira de clientes</h2>
              <p className="text-xs font-medium text-slate-500">Selecione uma empresa para gerenciar marca e acessos.</p>
            </div>
            <label className="relative block md:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm font-bold outline-none focus:border-[#2563EB]"
                placeholder="Buscar empresa..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
          </div>

          {loading ? (
            <div className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-100 bg-white">
              <Loader2 className="h-8 w-8 animate-spin text-[#2563EB]" />
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
              <Building2 className="mx-auto h-10 w-10 text-slate-300" />
              <h3 className="mt-4 text-sm font-black uppercase tracking-widest text-slate-700">Nenhuma empresa encontrada</h3>
              <p className="mt-2 text-sm font-medium text-slate-500">Cadastre ou ajuste a busca para localizar o cliente.</p>
            </div>
          ) : (
            filteredCompanies.map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
                active={selectedCompanyId === company.id}
                onSelect={() => setSelectedCompanyId(company.id)}
                onEdit={() => editCompany(company)}
              />
            ))
          )}
        </section>

        <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
          <form onSubmit={handleCompanySubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[#2563EB]">Dados do cliente</p>
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">
                  {companyForm.id ? "Editar Empresa" : "Cadastrar Empresa"}
                </h2>
              </div>
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

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Identidade visual</p>
                    <h3 className="text-sm font-black text-slate-800">Logo e cor da empresa</h3>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
                    {LOGO_WIDTH} x {LOGO_HEIGHT} px
                  </span>
                </div>

                <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white p-4 text-center transition-colors hover:border-[#2563EB]">
                  {logoPreview || companyForm.logo_url ? (
                    <img src={logoPreview || companyForm.logo_url} alt="Logo da empresa" className="max-h-24 max-w-full object-contain" />
                  ) : (
                    <>
                      <UploadCloud className="h-8 w-8 text-[#2563EB]" />
                      <span className="mt-2 text-xs font-black uppercase tracking-widest text-slate-700">Enviar logo</span>
                      <span className="mt-1 text-[11px] font-medium text-slate-500">PNG, JPG ou WEBP exatamente em {LOGO_WIDTH} x {LOGO_HEIGHT} px</span>
                    </>
                  )}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoChange} className="sr-only" />
                </label>

                <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <input type="color" value={companyForm.primary_color} onChange={(event) => setCompanyForm({ ...companyForm, primary_color: event.target.value })} className="h-10 w-12 cursor-pointer rounded-lg border-0 bg-transparent p-0" title="Cor principal da empresa" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cor principal</span>
                  </label>
                  <input className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black uppercase tracking-widest outline-none focus:border-[#2563EB]" value={companyForm.primary_color} onChange={(event) => setCompanyForm({ ...companyForm, primary_color: event.target.value })} placeholder="#2563EB" />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-[#2563EB]" />
                  <h3 className="text-sm font-black text-slate-800">Plano e cobrança</h3>
                </div>

                <div className="grid gap-3">
                  <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span>
                      <span className="block text-xs font-black uppercase tracking-widest text-slate-700">Treinamentos Premium</span>
                      <span className="mt-1 block text-[11px] font-medium text-slate-500">Libera menu de treinamentos, certificados e recursos premium.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={companyForm.training_enabled}
                      onChange={(event) => setCompanyForm({ ...companyForm, training_enabled: event.target.checked })}
                      className="h-5 w-5 shrink-0 accent-[#2563EB]"
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-[0.9fr_1.1fr]">
                    <label>
                      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Status financeiro</span>
                      <select
                        value={companyForm.subscription_status}
                        onChange={(event) => {
                          const status = event.target.value as CompanyForm["subscription_status"]
                          setCompanyForm({
                            ...companyForm,
                            subscription_status: status,
                            active: status !== "SUSPENDED",
                          })
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-widest outline-none focus:border-[#2563EB]"
                        title="Status financeiro"
                      >
                        <option value="ACTIVE">Em dia</option>
                        <option value="PAST_DUE">Em atraso</option>
                        <option value="SUSPENDED">Bloqueada</option>
                      </select>
                    </label>

                    <label className="flex items-center justify-between gap-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                      <span>
                        <span className="block text-xs font-black uppercase tracking-widest text-red-700">Desativar acesso</span>
                        <span className="mt-1 block text-[11px] font-medium text-red-600">Use quando a empresa nao pagar.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={!companyForm.active || companyForm.subscription_status === "SUSPENDED"}
                        onChange={(event) => setCompanyForm({
                          ...companyForm,
                          active: !event.target.checked,
                          subscription_status: event.target.checked ? "SUSPENDED" : "ACTIVE",
                        })}
                        className="h-5 w-5 shrink-0 accent-red-600"
                      />
                    </label>
                  </div>

                  <input
                    className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-[#2563EB]"
                    placeholder="Motivo do bloqueio ou observacao comercial"
                    value={companyForm.suspended_reason}
                    onChange={(event) => setCompanyForm({ ...companyForm, suspended_reason: event.target.value })}
                  />
                </div>
              </div>
            </div>

            <button disabled={submittingCompany} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60">
              {submittingCompany ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Salvar Empresa
            </button>
          </form>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Empresa selecionada</p>
                <h2 className="mt-1 truncate text-lg font-black tracking-tight text-slate-800">{selectedCompany?.trade_name || selectedCompany?.name || "Selecione uma empresa"}</h2>
              </div>
              {selectedCompany?.logo_url && (
                <div className="flex h-12 w-24 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <img src={selectedCompany.logo_url} alt={selectedCompany.trade_name || selectedCompany.name} className="max-h-full max-w-full object-contain" />
                </div>
              )}
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2">
              <MiniMetric icon={Users} label="Colab." value={selectedCompany?.employees_count || 0} />
              <MiniMetric icon={Package} label="EPIs" value={selectedCompany?.ppes_count || 0} />
              <MiniMetric icon={UserCog} label="Users" value={selectedCompany?.users_count || 0} />
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
          </section>
        </aside>
      </div>
    </div>
  )
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <Icon className="h-5 w-5 text-[#2563EB]" />
      <p className="mt-3 text-2xl font-black text-slate-900">{value}</p>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    </div>
  )
}

function MiniMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <Icon className="h-4 w-4 text-[#2563EB]" />
      <p className="mt-2 text-lg font-black text-slate-900">{value}</p>
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    </div>
  )
}

function CompanyCard({
  company,
  active,
  onSelect,
  onEdit,
}: {
  company: CompanyWithCounts
  active: boolean
  onSelect: () => void
  onEdit: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-2xl border p-4 text-left shadow-sm transition-all ${
        active ? "border-[#2563EB]/30 bg-white ring-4 ring-[#2563EB]/10" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-20 w-36 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-3">
            {company.logo_url ? (
              <img src={company.logo_url} alt={company.trade_name || company.name} className="max-h-full max-w-full object-contain" />
            ) : (
              <ImageIcon className="h-7 w-7 text-slate-300" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-black tracking-tight text-slate-800">{company.trade_name || company.name}</h2>
              <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${
                company.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}>
                {company.active ? "Ativa" : "Inativa"}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${
                company.training_enabled ? "bg-blue-50 text-[#2563EB]" : "bg-slate-100 text-slate-500"
              }`}>
                <GraduationCap className="h-3 w-3" />
                {company.training_enabled ? "Premium" : "Sem treino"}
              </span>
              {company.subscription_status === "SUSPENDED" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-red-700">
                  <ShieldOff className="h-3 w-3" />
                  Bloqueada
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-xs font-bold uppercase tracking-widest text-slate-400">{company.name}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500">
              {company.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{company.email}</span>}
              {company.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{company.phone}</span>}
              <span className="flex items-center gap-1">
                <Palette className="h-3.5 w-3.5" />
                <span className="inline-block h-3 w-3 rounded-full border border-slate-200" style={{ backgroundColor: company.primary_color }} />
                {company.primary_color}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <span className="rounded-xl bg-slate-50 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">
            {company.employees_count || 0} colab.
          </span>
          <span className="rounded-xl bg-slate-50 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">
            {company.users_count || 0} users
          </span>
          <span className="rounded-xl bg-slate-50 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">
            {company.ppes_count || 0} epis
          </span>
          <span
            onClick={(event) => {
              event.stopPropagation()
              onEdit()
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
}
