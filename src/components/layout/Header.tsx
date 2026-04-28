"use client"

import { usePathname } from "next/navigation"
import { NotificationBell } from "./NotificationBell"
import { GlobalSearch } from "./GlobalSearch"
import { useAuth } from "@/contexts/AuthContext"

export function Header() {
  const pathname = usePathname()
  const { user } = useAuth()

  // Mapeamento de rotas para títulos amigáveis
  const getPageTitle = (path: string) => {
    if (path === '/') return 'Visão Geral'
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
    return 'Antares SESMT'
  }

  return (
    <header className="h-16 md:h-20 border-b border-slate-100 bg-white/80 backdrop-blur-md sticky top-0 z-40 px-4 md:px-8 flex items-center justify-between">
      <div className="flex flex-col min-w-0">
        <span className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Módulo Atual</span>
        <h2 className="text-xs md:text-sm font-black text-slate-800 uppercase tracking-tighter leading-none truncate">{getPageTitle(pathname)}</h2>
      </div>

      <div className="flex-1 flex justify-center px-2 md:px-8">
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        <div className="hidden md:flex flex-col items-end mr-2">
            <span className="text-xs font-black text-slate-800 uppercase tracking-tighter">{user?.user_metadata?.full_name || user?.email}</span>
            <span className="text-[9px] font-black text-[#8B1A1A] uppercase tracking-widest italic">{user?.role}</span>
        </div>
        
        <NotificationBell />
      </div>
    </header>
  )
}

