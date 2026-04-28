"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Users, PenTool, History, TrendingDown, HardDrive, Package, LogOut, Menu, X, Shield, CheckCircle2, Settings, ArrowRightLeft, HelpCircle, BriefcaseBusiness } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"

const allItems = [
  { href: "/", label: "Dashboard", icon: Home, roles: ['ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/delivery", label: "Entrega", icon: PenTool, roles: ['ADMIN', 'ALMOXARIFE'] },
  { href: "/returns", label: "Baixas", icon: History, roles: ['ADMIN', 'ALMOXARIFE'] },
  { href: "/inventory", label: "Estoque", icon: Package, roles: ['ADMIN', 'ALMOXARIFE'] },
  { href: "/employees", label: "Equipe", icon: Users, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/workplaces", label: "Obras", icon: HardDrive, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/job-sectors", label: "Cargos", icon: BriefcaseBusiness, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/ppes", label: "EPIs e CAs", icon: Shield, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/history", label: "Histórico", icon: History, roles: ['ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/movements", label: "Movimentações", icon: ArrowRightLeft, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/reports", label: "Relatórios", icon: TrendingDown, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/training", label: "Treinamentos", icon: CheckCircle2, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/users", label: "Usuários", icon: Settings, roles: ['ADMIN'] },
  { href: "/support", label: "Suporte", icon: HelpCircle, roles: ['ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
]

export function MobileNav() {
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const filteredItems = allItems.filter(item => 
    item.roles.includes(user?.role || 'ADMIN')
  )

  // Top 4 items for the main bar
  const mainItems = filteredItems.slice(0, 4)
  return (
    <>
      {/* Bottom Bar */}
      <div className="md:hidden fixed bottom-0 w-full bg-white border-t border-slate-200 z-[100] px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] flex justify-around shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        {mainItems.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center p-2 rounded-lg min-w-[64px] transition-colors ${
                isActive ? "text-[#8B1A1A]" : "text-slate-400"
              }`}
            >
              <Icon className="w-6 h-6 mb-1" />
              <span className="text-[10px] font-bold uppercase tracking-tighter">{item.label}</span>
            </Link>
          )
        })}
        
        <button
          onClick={() => setIsMenuOpen(true)}
          className="flex flex-col items-center justify-center p-2 rounded-lg min-w-[64px] transition-colors text-slate-400"
        >
          <Menu className="w-6 h-6 mb-1" />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Mais</span>
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
          <div className="absolute bottom-0 w-full bg-white rounded-t-[2.5rem] shadow-2xl animate-in slide-in-from-bottom duration-300 flex flex-col max-h-[80dvh]">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-[2.5rem]">
              <div className="flex flex-col">
                <h3 className="font-black text-slate-800 uppercase tracking-tighter text-xl">Menu Geral</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Antares SESMT Digital</p>
              </div>
              <button 
                onClick={() => setIsMenuOpen(false)}
                className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100 text-slate-400"
                title="Fechar menu"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-16 custom-scrollbar">
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
                      className={`flex flex-col items-center justify-center p-6 rounded-3xl border-2 transition-all ${
                        isActive 
                          ? "bg-[#8B1A1A]/5 border-[#8B1A1A]/20 text-[#8B1A1A]" 
                          : "bg-white border-slate-50 text-slate-600 hover:border-slate-200"
                      }`}
                    >
                      <Icon className={`w-8 h-8 mb-3 ${isActive ? "text-[#8B1A1A]" : "text-slate-400"}`} />
                      <span className="text-[10px] font-black uppercase tracking-widest text-center">{item.label}</span>
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
                  className="w-full flex items-center justify-center gap-3 p-5 rounded-2xl bg-red-50 text-[#8B1A1A] font-black uppercase tracking-widest text-xs border-b-4 border-red-200 active:border-b-0 transition-all"
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

