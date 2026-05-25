"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { Home, Users, Shield, PenTool, History, TrendingDown, CheckCircle2, HardDrive, Package, LogOut, Settings, ArrowRightLeft, HelpCircle, BriefcaseBusiness, Building2, UserRoundCog, Handshake } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { useActiveBrand } from "@/hooks/useActiveBrand"

const menuItems = [
  { href: "/companies", label: "Empresas", icon: Building2, roles: ['MASTER'] },
  { href: "/", label: "Dashboard", icon: Home, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/delivery", label: "Nova Entrega", icon: PenTool, roles: ['MASTER', 'ADMIN'] },
  { href: "/inventory", label: "Estoque", icon: Package, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE'] },
  { href: "/workplaces", label: "Obras / Canteiros", icon: HardDrive, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/third-parties", label: "Terceiros", icon: Handshake, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/job-sectors", label: "Cargos / Setores", icon: BriefcaseBusiness, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/employees", label: "Colaboradores", icon: Users, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/ppes", label: "EPIs e CAs", icon: Shield, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/history", label: "Histórico", icon: History, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/movements", label: "Movimentações", icon: ArrowRightLeft, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/reports", label: "Relatórios", icon: TrendingDown, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/training", label: "Treinamentos", icon: CheckCircle2, roles: ['MASTER', 'ADMIN', 'DIRETORIA'] },
  { href: "/users", label: "Usuários", icon: Settings, roles: ['MASTER', 'ADMIN'] },
  { href: "/account", label: "Minha Conta", icon: UserRoundCog, roles: ['MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
  { href: "/support", label: "Ajuda / Suporte", icon: HelpCircle, roles: ['ADMIN', 'ALMOXARIFE', 'DIRETORIA'] },
]

function formatCnpj(value?: string | null) {
  const digits = (value || "").replace(/\D/g, "")
  if (digits.length !== 14) return value || "CNPJ nao informado"
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
}

export function Sidebar() {
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const activeBrand = useActiveBrand(user?.role === "MASTER" ? null : user?.company)
  const brandColor = activeBrand.primaryColor
  const brandLogo = activeBrand.logoUrl || "/logo.png"
  const brandName = activeBrand.name
  const companyCnpj = user?.company?.cnpj || null

  const filteredMenuItems = menuItems.filter(item =>
    item.roles.includes(user?.role || 'ADMIN') &&
    (item.href !== "/training" || user?.role === "MASTER" || user?.company?.training_enabled !== false)
  )

  return (
    <aside className="w-64 bg-white border-r border-slate-200 text-slate-600 hidden md:flex flex-col h-screen sticky top-0 shadow-sm">
      <div className="h-32 flex flex-col items-center justify-center border-b border-slate-100 bg-white p-4">
        <Image
          src={brandLogo}
          alt={brandName}
          width={190}
          height={80}
          className="h-20 w-auto max-w-[190px] object-contain"
          priority
          unoptimized={brandLogo.startsWith("http")}
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

      <div className="p-4 border-t border-slate-100 flex flex-col gap-3 bg-white">
        <button
          onClick={logout}
          className="flex items-center justify-center w-full px-3 py-2 text-xs font-bold text-slate-500 hover:text-red-600 hover:bg-blue-50 rounded-lg transition-colors group uppercase tracking-widest"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Encerrar Sessão
        </button>
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-center shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Sistema SESMT Digital</p>
          <p className="mt-1 truncate text-[11px] font-black uppercase tracking-widest" style={{ color: brandColor }} title={brandName}>
            {brandName}
          </p>
          <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-widest text-slate-400">
            {formatCnpj(companyCnpj)}
          </p>
        </div>
      </div>
    </aside>
  )
}
