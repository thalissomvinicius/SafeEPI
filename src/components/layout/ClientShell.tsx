"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import { Sidebar } from "@/components/layout/Sidebar"
import { MobileNav } from "@/components/layout/MobileNav"
import { Header } from "@/components/layout/Header"

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
      <main className="flex min-h-[100dvh] w-full max-w-full flex-1 flex-col overflow-x-hidden">
        {children}
      </main>
    )
  }

  return (
    <>
      <div className="relative flex h-[100dvh] min-h-[100dvh] w-full max-w-full overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 max-w-full flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-0">
            <div className="min-w-0 max-w-full flex-1">
              {children}
            </div>
            <footer className="w-full p-6 mt-8 border-t border-slate-200/60 bg-slate-50/50 text-center shrink-0">
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest flex items-center justify-center gap-1">
                Desenvolvido por
                <a 
                  href="https://wa.me/5591991697664" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="font-black text-[#2563EB] hover:underline transition-all"
                >
                  Vinicius Dev
                </a>
              </p>
            </footer>
          </main>
        </div>
      </div>
      <MobileNav />
    </>
  )
}
