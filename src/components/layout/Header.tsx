"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { NotificationBell } from "./NotificationBell"
import { GlobalSearch } from "./GlobalSearch"
import { useAuth } from "@/contexts/AuthContext"
import { api, type CompanyWithCounts } from "@/services/api"

function normalizeHexColor(color?: string | null) {
  if (!color) return "#2563EB"
  const trimmed = color.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed
  if (/^#[0-9A-Fa-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
  }
  return "#2563EB"
}

function darkenHexColor(color: string) {
  const hex = normalizeHexColor(color).slice(1)
  const value = Number.parseInt(hex, 16)
  const r = Math.max(0, Math.floor(((value >> 16) & 255) * 0.82))
  const g = Math.max(0, Math.floor(((value >> 8) & 255) * 0.82))
  const b = Math.max(0, Math.floor((value & 255) * 0.82))
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`
}

function applyCompanyTheme(company?: CompanyWithCounts | null) {
  if (!company?.primary_color) return
  const brandColor = normalizeHexColor(company.primary_color)
  document.body.classList.add("company-theme")
  document.body.style.setProperty("--brand-color", brandColor)
  document.body.style.setProperty("--brand-color-strong", darkenHexColor(brandColor))
}

export function Header() {
  const pathname = usePathname()
  const { user } = useAuth()
  const [companies, setCompanies] = useState<CompanyWithCounts[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState("")

  useEffect(() => {
    if (user?.role !== "MASTER") return

    const timer = window.setTimeout(async () => {
      try {
        const data = await api.getCompanies()
        setCompanies(data)
        const storedCompanyId = api.getMasterCompanyContext()
        const nextCompanyId = storedCompanyId || data[0]?.id || ""
        setSelectedCompanyId(nextCompanyId)
        applyCompanyTheme(data.find((company) => company.id === nextCompanyId))
        if (!storedCompanyId && nextCompanyId) {
          api.setMasterCompanyContext(nextCompanyId)
        }
      } catch (error) {
        console.error("Erro ao carregar empresas para contexto master:", error)
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [user])

  const handleMasterCompanyChange = (companyId: string) => {
    setSelectedCompanyId(companyId)
    api.setMasterCompanyContext(companyId)
    applyCompanyTheme(companies.find((company) => company.id === companyId))
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
          <select
            value={selectedCompanyId}
            onChange={(event) => handleMasterCompanyChange(event.target.value)}
            className="hidden max-w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 outline-none focus:border-[#2563EB] md:block"
            title="Empresa em contexto master"
          >
            <option value="">Selecione a empresa</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.trade_name || company.name}
              </option>
            ))}
          </select>
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

