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
      <main className="flex-1 w-full h-full overflow-y-auto">
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
          <main className="flex-1 overflow-y-auto pb-16 md:pb-0 relative z-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav />
    </>
  )
}
