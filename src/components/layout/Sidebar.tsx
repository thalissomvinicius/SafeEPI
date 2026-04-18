"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Users, Shield, PenTool, History, TrendingDown, CheckCircle2 } from "lucide-react"

const menuItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/delivery", label: "Nova Entrega", icon: PenTool },
  { href: "/employees", label: "Colaboradores", icon: Users },
  { href: "/ppes", label: "EPIs e CAs", icon: Shield },
  { href: "/history", label: "Histórico", icon: History },
  { href: "/reports", label: "Relatórios", icon: TrendingDown },
  { href: "/training", label: "Treinamentos", icon: CheckCircle2 },
]

import Image from "next/image"

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 bg-white border-r border-slate-200 text-slate-600 hidden md:flex flex-col h-screen sticky top-0 shadow-sm">
      <div className="h-28 flex flex-col items-center justify-center border-b border-slate-100 bg-slate-50/50 p-4">
        {/* Logo Placeholder - O usuário deve salvar a imagem como public/logo.png */}
        <div className="relative w-full h-12 mb-2 flex justify-center items-center">
            <span className="text-[#8B1A1A] font-black text-2xl tracking-tighter">ANTARES</span>
        </div>
        <span className="text-[10px] text-slate-500 font-bold tracking-[0.3em] uppercase">Empreendimentos</span>
      </div>
      
      <nav className="flex-1 py-6 px-3 space-y-1">
        {menuItems.map((item) => {
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

      <div className="p-4 border-t border-slate-100 text-[10px] text-slate-400 text-center uppercase tracking-widest font-bold">
        <p>Sistema SESMT Digital</p>
        <p className="mt-1 text-[#8B1A1A]">Antares v1.0</p>
      </div>
    </aside>
  )
}
