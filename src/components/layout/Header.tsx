"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Building2, ChevronDown } from "lucide-react"
import { NotificationBell } from "./NotificationBell"
import { GlobalSearch } from "./GlobalSearch"
import { useAuth } from "@/contexts/AuthContext"
import { api, type CompanyWithCounts } from "@/services/api"
import { applyCompanyBrand } from "@/lib/brandTheme"

export function Header() {
  const pathname = usePathname()
  const { user } = useAuth()
  const [companies, setCompanies] = useState<CompanyWithCounts[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState("")

  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) || null

  useEffect(() => {
    if (user?.role !== "MASTER") return

    const timer = window.setTimeout(async () => {
      try {
        const data = await api.getCompanies()
        setCompanies(data)
        const storedCompanyId = api.getMasterCompanyContext()
        const storedCompany = data.find((company) => company.id === storedCompanyId && company.active !== false)
        const defaultCompany = data.find((company) => company.active !== false) || data[0] || null
        const nextCompanyId = storedCompany?.id || defaultCompany?.id || ""

        if (storedCompanyId !== nextCompanyId) {
          api.setMasterCompanyContext(nextCompanyId || null)
        }

        setSelectedCompanyId(nextCompanyId)
        void applyCompanyBrand(data.find((company) => company.id === nextCompanyId), { enableTheme: true })
      } catch (error) {
        console.error("Erro ao carregar empresas para contexto master:", error)
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [user])

  const handleMasterCompanyChange = async (companyId: string) => {
    setSelectedCompanyId(companyId)
    api.setMasterCompanyContext(companyId)
    void applyCompanyBrand(companies.find((company) => company.id === companyId), { enableTheme: true })
    window.location.reload()
  }

  // Mapeamento de rotas para títulos amigáveis
  const getPageTitle = (path: string) => {
    if (path === '/') return 'Visão Geral'
    if (path.startsWith('/account')) return 'Minha Conta'
    if (path.startsWith('/companies')) return 'Empresas Clientes'
    if (path.startsWith('/employees')) return 'Colaboradores'
    if (path.startsWith('/inventory')) return 'Gestão de Estoque'
    if (path.startsWith('/ppes')) return 'Catálogo de EPIs'
    if (path.startsWith('/delivery')) return 'Nova Entrega'
    if (path.startsWith('/history')) return 'Histórico de entregas'
    if (path.startsWith('/movements')) return 'Movimentações'
    if (path.startsWith('/reports')) return 'Relatórios e indicadores'
    if (path.startsWith('/training')) return 'Treinamentos'
    if (path.startsWith('/users')) return 'Administração'
    if (path.startsWith('/workplaces')) return 'Obras e Canteiros'
    if (path.startsWith('/third-parties')) return 'Terceiros'
    if (path.startsWith('/job-sectors')) return 'Cargos e Setores'
    if (path.startsWith('/support')) return 'Ajuda e suporte'
    return 'SafeEPI'
  }

  return (
    <header className="sticky top-0 z-40 flex min-h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 bg-white px-3 pt-[env(safe-area-inset-top)] sm:px-5 md:px-7">
      <div className="flex min-w-0 max-w-[42vw] flex-col md:max-w-none">
        <span className="mb-1 hidden text-[11px] font-medium leading-none text-slate-400 sm:block">Área de trabalho</span>
        <h2 className="truncate text-sm font-semibold leading-snug tracking-tight text-slate-800">{getPageTitle(pathname)}</h2>
      </div>

      <div className="flex flex-none justify-center px-0 lg:flex-1 lg:px-5">
        <GlobalSearch />
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-1.5 md:gap-3">
        {user?.role === "MASTER" && (
          <div className="relative flex h-11 flex-shrink-0 items-center">
            <div className="pointer-events-none flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 lg:hidden">
              <Building2 className="h-4 w-4" />
            </div>
            <select
              value={selectedCompanyId}
              onChange={(event) => void handleMasterCompanyChange(event.target.value)}
              className="absolute inset-0 h-11 w-11 cursor-pointer opacity-0 lg:static lg:h-10 lg:w-44 lg:appearance-none lg:rounded-xl lg:border lg:border-slate-200 lg:bg-white lg:px-3 lg:pr-8 lg:text-xs lg:font-medium lg:text-slate-700 lg:opacity-100 lg:outline-none lg:focus:border-[var(--brand-color)] xl:w-52"
              title="Alterar empresa em contexto master"
              aria-label="Alterar empresa em contexto master"
            >
              <option value="">Selecionar empresa</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.trade_name || company.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-slate-400 lg:block" />
            <span className="sr-only">
              Empresa atual: {selectedCompany ? selectedCompany.trade_name || selectedCompany.name : "nenhuma"}
            </span>
          </div>
        )}
        <div className="hidden max-w-40 flex-col items-end border-l border-slate-200 pl-3 xl:flex">
            <span className="max-w-full truncate text-xs font-semibold text-slate-700" title={user?.user_metadata?.full_name || user?.email}>{user?.user_metadata?.full_name || user?.email}</span>
            <span className="mt-0.5 text-[10px] font-medium text-slate-400">{user?.role === "MASTER" ? "Gestão da plataforma" : user?.role === "ADMIN" ? "Administrador" : user?.role === "DIRETORIA" ? "Diretoria" : "Almoxarifado"}</span>
        </div>
        
        <NotificationBell />
      </div>
    </header>
  )
}
