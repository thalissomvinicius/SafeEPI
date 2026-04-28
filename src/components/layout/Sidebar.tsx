"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Users, Shield, PenTool, History, TrendingDown, CheckCircle2, HardDrive, Package, LogOut, Settings, ArrowRightLeft, HelpCircle } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"

const menuItems = [
  { href: "/", label: "Dashboard", icon: Home, roles: ['ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/delivery", label: "Nova Entrega", icon: PenTool, roles: ['ADMIN', 'ALMOXARIFE'] },
  { href: "/returns", label: "Baixas / Substituições", icon: ArrowRightLeft, roles: ['ADMIN', 'ALMOXARIFE'] },
  { href: "/inventory", label: "Estoque", icon: Package, roles: ['ADMIN', 'ALMOXARIFE'] },
  { href: "/workplaces", label: "Obras / Canteiros", icon: HardDrive, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/employees", label: "Colaboradores", icon: Users, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/ppes", label: "EPIs e CAs", icon: Shield, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/history", label: "Histórico", icon: History, roles: ['ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/movements", label: "Movimentações", icon: ArrowRightLeft, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/reports", label: "Relatórios", icon: TrendingDown, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/training", label: "Treinamentos", icon: CheckCircle2, roles: ['ADMIN', 'DIRETORIA'] },
  { href: "/users", label: "Usuários", icon: Settings, roles: ['ADMIN'] },
  { href: "/support", label: "Ajuda / Suporte", icon: HelpCircle, roles: ['ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
]


export function Sidebar() {
  const pathname = usePathname()
  const { logout, user } = useAuth()
  
  const filteredMenuItems = menuItems.filter(item => 
    item.roles.includes(user?.role || 'ADMIN')
  )

  return (
    <aside className="w-64 bg-white border-r border-slate-200 text-slate-600 hidden md:flex flex-col h-screen sticky top-0 shadow-sm">
      <div className="h-28 flex flex-col items-center justify-center border-b border-slate-100 bg-slate-50/50 p-4">
        {/* Logo Placeholder - O usuário deve salvar a imagem como public/logo.png */}
        <div className="relative w-full h-12 mb-2 flex justify-center items-center">
            <span className="text-[#8B1A1A] font-black text-2xl tracking-tighter">ANTARES</span>
        </div>
        <span className="text-[10px] text-slate-500 font-bold tracking-[0.3em] uppercase">Empreendimentos</span>
      </div>
      
      <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto custom-scrollbar">
        {filteredMenuItems.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2.5 rounded-lg transition-colors group ${
                isActive 
                  ? "bg-[#8B1A1A]/5 text-[#8B1A1A] font-medium border-l-4 border-[#8B1A1A]" 
                  : "hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className={`w-5 h-5 mr-3 ${isActive ? "text-[#8B1A1A]" : "text-slate-400 group-hover:text-[#8B1A1A]"}`} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-slate-100 flex flex-col gap-3">
        <button 
          onClick={logout}
          className="flex items-center justify-center w-full px-3 py-2 text-xs font-bold text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors group uppercase tracking-widest"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Encerrar Sessão
        </button>
        <div className="text-[10px] text-slate-400 text-center uppercase tracking-widest font-bold">
          <p>Sistema SESMT Digital</p>
          <p className="mt-1 text-[#8B1A1A]">Antares v1.0</p>
        </div>
      </div>
    </aside>
  )
}

