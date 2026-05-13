"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Users, PenTool, History, TrendingDown, HardDrive, Package, LogOut, Menu, X, Shield, CheckCircle2, Settings, ArrowRightLeft, HelpCircle, BriefcaseBusiness, Building2, UserRoundCog } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { useActiveBrand } from "@/hooks/useActiveBrand"

const allItems = [
  { href: "/companies", label: "Empresas", icon: Building2, roles: ['MASTER'] },
  { href: "/", label: "Dashboard", icon: Home, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/delivery", label: "Entrega", icon: PenTool, roles: ['MASTER', 'ADMIN'] },
  { href: "/inventory", label: "Estoque", icon: Package, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE'] },
  { href: "/employees", label: "Equipe", icon: Users, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/workplaces", label: "Obras", icon: HardDrive, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/job-sectors", label: "Cargos", icon: BriefcaseBusiness, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/ppes", label: "EPIs e CAs", icon: Shield, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/history", label: "Histórico", icon: History, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/movements", label: "Movimentações", icon: ArrowRightLeft, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/reports", label: "Relatórios", icon: TrendingDown, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/training", label: "Treinamentos", icon: CheckCircle2, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/users", label: "Usuários", icon: Settings, roles: ['MASTER', 'ADMIN'] },
  { href: "/account", label: "Conta", icon: UserRoundCog, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/support", label: "Suporte", icon: HelpCircle, roles: ['ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
]

export function MobileNav() {
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const activeBrand = useActiveBrand(user?.role === "MASTER" ? null : user?.company)
  const brandColor = activeBrand.primaryColor
  const brandName = activeBrand.name

  const filteredItems = allItems.filter(item => 
    item.roles.includes(user?.role || 'ADMIN') &&
    (item.href !== "/training" || user?.role === "MASTER" || user?.company?.training_enabled !== false)
  )

  // Top 4 items for the main bar
  const mainItems = filteredItems.slice(0, 4)
  return (
    <>
      {/* Bottom Bar */}
      <div className="md:hidden fixed inset-x-0 bottom-0 bg-white border-t border-slate-200 z-[100] px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] grid grid-cols-5 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        {mainItems.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              style={isActive ? { color: brandColor } : undefined}
              className={`flex min-h-14 flex-col items-center justify-center rounded-xl px-1.5 py-2 transition-colors ${
                isActive ? "text-[#2563EB]" : "text-slate-400"
              }`}
            >
              <Icon className="w-5 h-5 mb-1" />
              <span className="max-w-full truncate text-[9px] font-black uppercase leading-none tracking-normal">{item.label}</span>
            </Link>
          )
        })}
        
        <button
          onClick={() => setIsMenuOpen(true)}
          className="flex min-h-14 flex-col items-center justify-center rounded-xl px-1.5 py-2 transition-colors text-slate-400"
        >
          <Menu className="w-5 h-5 mb-1" />
          <span className="text-[9px] font-black uppercase leading-none tracking-normal">Mais</span>
        </button>
      </div>

      {/* Full Screen / Drawer Menu */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-[110] md:hidden">
          {/* Overlay */}
          <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" 
            onClick={() => setIsMenuOpen(false)}
          ></div>
          
          {/* Menu Content */}
          <div className="absolute bottom-0 w-full bg-white rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom duration-300 flex flex-col max-h-[88dvh]">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-3xl">
              <div className="flex flex-col">
                <h3 className="font-black text-slate-800 uppercase tracking-tighter text-xl">Menu Geral</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{brandName} Digital</p>
              </div>
              <button 
                onClick={() => setIsMenuOpen(false)}
                className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100 text-slate-400"
                title="Fechar menu"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+5rem)] custom-scrollbar">
              <div className="grid grid-cols-2 gap-3">
                {/* Repetir os principais também no menu para conveniência */}
                {filteredItems.map((item) => {
                  const isActive = pathname === item.href
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsMenuOpen(false)}
                      style={isActive ? { color: brandColor, borderColor: `${brandColor}33`, backgroundColor: `${brandColor}0D` } : undefined}
                      className={`flex min-h-24 flex-col items-center justify-center rounded-2xl border p-4 transition-all ${
                        isActive 
                          ? "bg-[#2563EB]/5 border-[#2563EB]/20 text-[#2563EB]" 
                          : "bg-white border-slate-50 text-slate-600 hover:border-slate-200"
                      }`}
                    >
                      <Icon className={`w-7 h-7 mb-3 ${isActive ? "text-[#2563EB]" : "text-slate-400"}`} style={isActive ? { color: brandColor } : undefined} />
                      <span className="max-w-full text-center text-[10px] font-black uppercase leading-tight tracking-wide break-words">{item.label}</span>
                    </Link>
                  )
                })}
              </div>

              <div className="mt-8 pt-8 border-t border-slate-100">
                <button
                  onClick={() => {
                    setIsMenuOpen(false)
                    logout()
                  }}
                  className="w-full flex items-center justify-center gap-3 p-5 rounded-2xl bg-blue-50 text-[#2563EB] font-black uppercase tracking-widest text-xs shadow-sm hover:bg-blue-100 transition-all"
                >
                  <LogOut className="w-5 h-5" />
                  Encerrar Sessão
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

