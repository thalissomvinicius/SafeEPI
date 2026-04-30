"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Users, Shield, PenTool, History, TrendingDown, CheckCircle2, HardDrive, Package, LogOut, Settings, ArrowRightLeft, HelpCircle, BriefcaseBusiness, Building2, UserRoundCog } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"

const menuItems = [
  { href: "/companies", label: "Empresas", icon: Building2, roles: ['MASTER'] },
  { href: "/", label: "Dashboard", icon: Home, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/delivery", label: "Nova Entrega", icon: PenTool, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE'] },
  { href: "/inventory", label: "Estoque", icon: Package, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE'] },
  { href: "/workplaces", label: "Obras / Canteiros", icon: HardDrive, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/job-sectors", label: "Cargos / Setores", icon: BriefcaseBusiness, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/employees", label: "Colaboradores", icon: Users, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/ppes", label: "EPIs e CAs", icon: Shield, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/history", label: "Histórico", icon: History, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/movements", label: "Movimentações", icon: ArrowRightLeft, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/reports", label: "Relatórios", icon: TrendingDown, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/training", label: "Treinamentos", icon: CheckCircle2, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/users", label: "Usuários", icon: Settings, roles: ['MASTER', 'ADMIN'] },
  { href: "/account", label: "Minha Conta", icon: UserRoundCog, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/support", label: "Ajuda / Suporte", icon: HelpCircle, roles: ['ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
]


export function Sidebar() {
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const brandColor = user?.company?.primary_color || "#2563EB"
  const brandLogo = user?.company?.logo_url || "/logo.png"
  const brandName = user?.company?.trade_name || user?.company?.name || "SafeEPI"
  
  const filteredMenuItems = menuItems.filter(item => 
    item.roles.includes(user?.role || 'ADMIN') &&
    (item.href !== "/training" || user?.role === "MASTER" || user?.company?.training_enabled !== false)
  )

  return (
    <aside className="w-64 bg-white border-r border-slate-200 text-slate-600 hidden md:flex flex-col h-screen sticky top-0 shadow-sm">
      <div className="h-32 flex flex-col items-center justify-center border-b border-slate-100 bg-white p-4">
        <img
          src={brandLogo}
          alt={brandName}
          className="h-20 w-auto max-w-[190px] object-contain"
        />
      </div>
      
      <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto custom-scrollbar">
        {filteredMenuItems.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              style={isActive ? { borderLeftColor: brandColor, color: brandColor, backgroundColor: `${brandColor}0D` } : undefined}
              className={`flex items-center px-3 py-2.5 rounded-lg transition-colors group ${
                isActive 
                  ? "font-medium border-l-4"
                  : "hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className="w-5 h-5 mr-3 text-slate-400 group-hover:text-[#2563EB]" style={isActive ? { color: brandColor } : undefined} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-slate-100 flex flex-col gap-3">
        <button 
          onClick={logout}
          className="flex items-center justify-center w-full px-3 py-2 text-xs font-bold text-slate-500 hover:text-red-600 hover:bg-blue-50 rounded-lg transition-colors group uppercase tracking-widest"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Encerrar Sessão
        </button>
        <div className="text-[10px] text-slate-400 text-center uppercase tracking-widest font-bold">
          <p>Sistema SESMT Digital</p>
          <p className="mt-1" style={{ color: brandColor }}>{brandName} v1.0</p>
        </div>
      </div>
    </aside>
  )
}

