"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { LogOut, ShieldCheck } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { useActiveBrand } from "@/hooks/useActiveBrand"
import { isNavigationActive, navigationGroups, visibleNavigation } from "./navigation"

function formatCnpj(value?: string | null) {
  const digits = (value || "").replace(/\D/g, "")
  if (digits.length !== 14) return value || "CNPJ não informado"
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
}

export function Sidebar() {
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const activeBrand = useActiveBrand(user?.role === "MASTER" ? null : user?.company)
  const brandColor = activeBrand.primaryColor
  const brandLogo = activeBrand.logoUrl || "/logo.png"
  const brandName = activeBrand.name
  const companyCnpj = user?.company?.cnpj || activeBrand.cnpj || null

  const filteredMenuItems = visibleNavigation(user?.role, user?.company?.training_enabled)

  return (
    <aside aria-label="Navegação principal" className="sticky top-0 hidden h-[100dvh] w-[244px] shrink-0 flex-col border-r border-slate-200/80 bg-white text-slate-600 md:flex">
      <Link href="/" aria-label="Ir para a visão geral" className="flex h-24 shrink-0 items-center justify-center border-b border-slate-100 px-6 py-4">
        <Image
          src={brandLogo}
          alt={brandName}
          width={190}
          height={80}
          className="h-14 w-auto max-w-[174px] object-contain"
          priority
          unoptimized={brandLogo.startsWith("http")}
        />
      </Link>

      <nav className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-5">
        {navigationGroups.map((group) => {
          const items = filteredMenuItems.filter((item) => item.group === group)
          if (items.length === 0) return null
          return (
            <div key={group}>
              <p className="mb-2 px-3 text-[11px] font-semibold tracking-wide text-slate-400">{group}</p>
              <div className="space-y-1">
                {items.map((item) => {
                  const isActive = isNavigationActive(pathname, item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      style={isActive ? { color: brandColor, backgroundColor: "var(--brand-tint)" } : undefined}
                      className={`group flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition-colors duration-150 ${
                        isActive ? "font-semibold" : "font-medium hover:bg-slate-50 hover:text-slate-900"
                      }`}
                    >
                      <Icon aria-hidden="true" strokeWidth={1.8} className="h-[18px] w-[18px] shrink-0 text-slate-400 group-hover:text-slate-700" style={isActive ? { color: brandColor } : undefined} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 space-y-3 border-t border-slate-100 p-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-400"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />SESMT Digital</div>
          <p className="truncate text-xs font-semibold text-slate-700" title={brandName}>{brandName}</p>
          <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{formatCnpj(companyCnpj)}</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Encerrar sessão
        </button>
      </div>
    </aside>
  )
}
