"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOut, Menu, X } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { useActiveBrand } from "@/hooks/useActiveBrand"
import { AccessibleOverlay } from "@/components/ui/AccessibleOverlay"
import { isNavigationActive, navigationGroups, visibleNavigation } from "./navigation"

export function MobileNav() {
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setIsMenuOpen(false), [])
  const activeBrand = useActiveBrand(user?.role === "MASTER" ? null : user?.company)
  const filteredItems = visibleNavigation(user?.role, user?.company?.training_enabled)
  const preferredHrefs = ["/", "/delivery", "/inventory", "/employees"]
  const preferredItems = preferredHrefs.flatMap((href) => filteredItems.filter((item) => item.href === href))
  const mainItems = [...preferredItems, ...filteredItems.filter((item) => !preferredHrefs.includes(item.href))].slice(0, 4)

  return <>
    <nav aria-label="Navegação móvel" className="fixed inset-x-0 bottom-0 z-[60] grid grid-cols-5 border-t border-slate-200/80 bg-white px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1.5 md:hidden">
      {mainItems.map((item) => {
        const active = isNavigationActive(pathname, item.href)
        const Icon = item.icon
        return <Link
          key={item.href}
          href={item.href}
          aria-current={active ? "page" : undefined}
          style={active ? { color: activeBrand.primaryColor, backgroundColor: "var(--brand-tint)" } : undefined}
          className="flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-slate-500 transition-colors active:bg-slate-100"
        >
          <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          <span className="max-w-full truncate text-[10px] font-medium leading-none">{item.shortLabel}</span>
        </Link>
      })}
      <button type="button" onClick={() => setIsMenuOpen(true)} aria-expanded={isMenuOpen} aria-controls="mobile-navigation-menu" className="flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-slate-500 transition-colors active:bg-slate-100">
        <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.8} />
        <span className="text-[10px] font-medium leading-none">Mais</span>
      </button>
    </nav>

    {isMenuOpen && <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/45 md:hidden" onClick={(event) => {
      if (event.target === event.currentTarget) closeMenu()
    }}>
      <AccessibleOverlay id="mobile-navigation-menu" label="Todos os módulos" onClose={closeMenu} className="safeepi-panel-enter flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Todos os módulos</h2>
            <p className="mt-1 truncate text-xs text-slate-500">{activeBrand.name}</p>
          </div>
          <button type="button" onClick={closeMenu} aria-label="Fechar menu" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Todos os módulos" className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
          {navigationGroups.map((group) => {
            const items = filteredItems.filter((item) => item.group === group)
            if (items.length === 0) return null
            return <div key={group}>
              <p className="mb-2 px-2 text-xs font-semibold text-slate-400">{group}</p>
              <div className="grid grid-cols-2 gap-1.5">{items.map((item) => {
                const active = isNavigationActive(pathname, item.href)
                const Icon = item.icon
                return <Link key={item.href} href={item.href} onClick={closeMenu} aria-current={active ? "page" : undefined} style={active ? { color: activeBrand.primaryColor, backgroundColor: "var(--brand-tint)" } : undefined} className="flex min-h-12 items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50">
                  <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} aria-hidden="true" />
                  <span className="min-w-0 leading-snug">{item.label}</span>
                </Link>
              })}</div>
            </div>
          })}
        </nav>
        <div className="shrink-0 border-t border-slate-100 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <button type="button" onClick={() => { closeMenu(); void logout() }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-700">
            <LogOut className="h-4 w-4" aria-hidden="true" />Encerrar sessão
          </button>
        </div>
      </AccessibleOverlay>
    </div>}
  </>
}
