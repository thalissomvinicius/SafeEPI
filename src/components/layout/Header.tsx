"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Building2, Check, X } from "lucide-react"
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
  const [companySwitcherOpen, setCompanySwitcherOpen] = useState(false)

  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) || null

  useEffect(() => {
    if (user?.role !== "MASTER") return

    const timer = window.setTimeout(async () => {
      try {
        const data = await api.getCompanies()
        setCompanies(data)
        const storedCompanyId = api.getMasterCompanyContext()
        const nextCompanyId = storedCompanyId || data[0]?.id || ""
        setSelectedCompanyId(nextCompanyId)
        void applyCompanyBrand(data.find((company) => company.id === nextCompanyId), { enableTheme: true })
        if (!storedCompanyId && nextCompanyId) {
          api.setMasterCompanyContext(nextCompanyId)
        }
      } catch (error) {
        console.error("Erro ao carregar empresas para contexto master:", error)
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [user])

  const handleMasterCompanyChange = async (companyId: string) => {
    setSelectedCompanyId(companyId)
    api.setMasterCompanyContext(companyId)
    await applyCompanyBrand(companies.find((company) => company.id === companyId), { enableTheme: true })
    setCompanySwitcherOpen(false)
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
    if (path.startsWith('/history')) return 'Audit (Histórico)'
    if (path.startsWith('/reports')) return 'Business Intelligence'
    if (path.startsWith('/training')) return 'Treinamentos'
    if (path.startsWith('/users')) return 'Administração'
    if (path.startsWith('/workplaces')) return 'Obras e Canteiros'
    if (path.startsWith('/third-parties')) return 'Terceiros'
    if (path.startsWith('/job-sectors')) return 'Cargos e Setores'
    return 'SafeEPI'
  }

  return (
    <header className="h-16 md:h-20 border-b border-slate-100 bg-white/80 backdrop-blur-md sticky top-0 z-40 px-3 sm:px-4 md:px-8 flex items-center justify-between gap-2">
      <div className="flex flex-col min-w-0 max-w-[52vw] md:max-w-none">
        <span className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Módulo Atual</span>
        <h2 className="text-xs md:text-sm font-black text-slate-800 uppercase tracking-tighter leading-none truncate">{getPageTitle(pathname)}</h2>
      </div>

      <div className="flex flex-none md:flex-1 justify-center px-0 md:px-8">
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        {user?.role === "MASTER" && (
          <>
            <button
              type="button"
              onClick={() => setCompanySwitcherOpen(true)}
              className="flex min-h-[44px] max-w-[42vw] items-center gap-2 rounded-xl border border-[#2563EB]/25 bg-white px-3 py-2 text-left text-[#2563EB] shadow-sm transition-all hover:border-[#2563EB] hover:bg-red-50 sm:max-w-64"
              title="Alterar empresa em contexto master"
            >
              <Building2 className="h-4 w-4 flex-shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-[10px] font-black uppercase leading-none tracking-widest">
                  Alterar empresa
                </span>
                <span className="mt-1 hidden truncate text-[9px] font-bold uppercase tracking-wide text-slate-500 sm:block">
                  {selectedCompany ? selectedCompany.trade_name || selectedCompany.name : "Selecionar contexto"}
                </span>
              </span>
            </button>

            {companySwitcherOpen && (
              <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm md:items-center md:p-4">
                <button
                  type="button"
                  aria-label="Fechar seleção de empresa"
                  className="absolute inset-0 h-full w-full cursor-default"
                  onClick={() => setCompanySwitcherOpen(false)}
                />
                <div className="relative z-[101] flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl md:rounded-3xl">
                  <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Contexto master</p>
                      <h3 className="mt-1 text-lg font-black uppercase tracking-tight text-slate-900">Alterar empresa</h3>
                      <p className="mt-1 text-sm font-medium text-slate-500">Escolha qual cliente será usado nas telas operacionais.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCompanySwitcherOpen(false)}
                      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      title="Fechar"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3">
                    {companies.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                        <p className="text-sm font-black uppercase tracking-wide text-slate-700">Nenhuma empresa carregada</p>
                        <p className="mt-1 text-sm font-medium text-slate-500">Recarregue a página ou confira seu acesso master.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {companies.map((company) => {
                          const active = company.id === selectedCompanyId
                          return (
                            <button
                              key={company.id}
                              type="button"
                              onClick={() => void handleMasterCompanyChange(company.id)}
                              className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-all ${
                                active
                                  ? "border-[#2563EB]/30 bg-red-50 text-[#2563EB]"
                                  : "border-slate-100 bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                              }`}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-black uppercase tracking-tight">
                                  {company.trade_name || company.name}
                                </span>
                                <span className="mt-1 block truncate text-xs font-bold text-slate-500">
                                  {company.cnpj || company.email || "Empresa sem CNPJ informado"}
                                </span>
                              </span>
                              {active && <Check className="h-5 w-5 flex-shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div className="hidden md:flex flex-col items-end mr-2">
            <span className="text-xs font-black text-slate-800 uppercase tracking-tighter">{user?.user_metadata?.full_name || user?.email}</span>
            <span className="text-[9px] font-black text-[#2563EB] uppercase tracking-widest italic">{user?.role}</span>
        </div>
        
        <NotificationBell />
      </div>
    </header>
  )
}

