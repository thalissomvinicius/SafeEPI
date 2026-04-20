"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Users, PenTool, History, TrendingDown, HardDrive, Package, LogOut } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"

const mobileItems = [
  { href: "/", label: "Início", icon: Home },
  { href: "/delivery", label: "Entrega", icon: PenTool },
  { href: "/inventory", label: "Estoque", icon: Package },
  { href: "/workplaces", label: "Canteiro", icon: HardDrive },
  { href: "/employees", label: "Equipe", icon: Users },
  { href: "/history", label: "Histórico", icon: History },
  { href: "/reports", label: "BI", icon: TrendingDown },
]

export function MobileNav() {
  const pathname = usePathname()
  const { logout } = useAuth()

  return (
    <div className="md:hidden fixed bottom-0 w-full bg-white border-t border-slate-200 z-50 px-2 py-2 flex justify-around pb-safe shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
      {mobileItems.map((item) => {
        const isActive = pathname === item.href
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center p-2 rounded-lg min-w-[64px] transition-colors ${
              isActive ? "text-[#8B1A1A]" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <Icon className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        )
      })}
      <button
        onClick={logout}
        className="flex flex-col items-center justify-center p-2 rounded-lg min-w-[64px] transition-colors text-slate-400 hover:text-red-600"
      >
        <LogOut className="w-6 h-6 mb-1" />
        <span className="text-[10px] font-medium">Sair</span>
      </button>
    </div>
  )
}
