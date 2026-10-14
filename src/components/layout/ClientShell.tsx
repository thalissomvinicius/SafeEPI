"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import { Sidebar } from "@/components/layout/Sidebar"
import { MobileNav } from "@/components/layout/MobileNav"
import { Header } from "@/components/layout/Header"
import { DeveloperCredit } from "@/components/layout/DeveloperCredit"

export function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuth()

  // Não renderizar shell de navegação se estiver na tela de login ou se não houver usuário logado (ex. carregando o deslogamento)
  const isLoginPage = pathname === '/login'
  const isPublicRemotePage =
    pathname?.startsWith("/delivery/remote") ||
    pathname?.startsWith("/training/remote") ||
    pathname?.startsWith("/capture")

  if (isLoginPage || isPublicRemotePage || !user) {
    return (
      <main id="main-content" tabIndex={-1} className="flex min-h-[100dvh] w-full max-w-full flex-1 flex-col overflow-x-hidden">
        {children}
        {!isLoginPage && <footer className="mt-auto shrink-0 px-4 py-3 text-center"><DeveloperCredit /></footer>}
      </main>
    )
  }

  return (
    <>
      <div className="app-shell relative flex h-[100dvh] min-h-[100dvh] w-full max-w-full overflow-hidden bg-slate-50">
        <Sidebar />
        <div className="flex min-w-0 max-w-full flex-1 flex-col overflow-hidden">
          <Header />
          <main id="main-content" tabIndex={-1} className="app-workspace flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-0">
            <div className="mx-auto min-w-0 w-full max-w-[1600px] flex-1">
              {children}
            </div>
            <footer className="mt-6 flex w-full shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200/60 px-5 py-4 text-[11px] text-slate-400 md:px-8">
              <span>SafeEPI · Gestão de segurança do trabalho</span>
              <DeveloperCredit />
            </footer>
          </main>
        </div>
      </div>
      <MobileNav />
    </>
  )
}
