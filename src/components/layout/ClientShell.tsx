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

  if (isLoginPage || !user) {
    return (
      <main className="flex-1 w-full flex flex-col">
        {children}
      </main>
    )
  }

  return (
    <>
      <div className="flex h-screen overflow-hidden w-full relative">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto pb-16 md:pb-0 flex flex-col">
            <div className="flex-1">
              {children}
            </div>
            <footer className="w-full p-6 mt-8 border-t border-slate-200/60 bg-slate-50/50 text-center shrink-0">
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest flex items-center justify-center gap-1">
                Desenvolvido por
                <a 
                  href="https://wa.me/5591991697664" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="font-black text-[#8B1A1A] hover:underline transition-all"
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
