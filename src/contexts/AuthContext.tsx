"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { api } from "@/services/api"
import { useRouter, usePathname } from "next/navigation"
import { Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"

export type User = {
  id: string
  email?: string
  user_metadata?: {
    full_name?: string
    role?: 'ADMIN' | 'ALMOXARIFE' | 'DIRETORIA'
  }
  role?: 'ADMIN' | 'ALMOXARIFE' | 'DIRETORIA'
}

type AuthContextType = {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    async function checkAuth() {
      try {
        const session = await api.getSession()
        if (session) {
          // Busca o perfil completo no banco de dados (incluindo o papel/role atualizado)
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle()

          const userData = {
            ...session.user,
            role: (profile?.role || session.user.user_metadata?.role || 'ALMOXARIFE') as 'ADMIN' | 'ALMOXARIFE' | 'DIRETORIA'
          }

          // Bypass temporário para garantir seu acesso administrativo
          if (session.user.email === 'thalissomvinicius7@gmail.com' || session.user.email === 'thalissom.cruz@VALLE.br') {
            userData.role = 'ADMIN'
          }

          setUser(userData as User)
        } else {
          setUser(null)
          if (pathname !== '/login' && !pathname?.startsWith('/delivery/remote')) {
            router.push('/login')
          }
        }
      } catch (error) {
        console.error("Auth error:", error)
        setUser(null)
      } finally {
        setLoading(false)
      }
    }

    checkAuth()
  }, [pathname, router])

  const logout = async () => {
    try {
      await api.logout()
      setUser(null)
      router.push('/login')
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  // Se estiver carregando e não estiver na rota de login, exibe spinner em tela cheia para evitar piscar o layout restrito.
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-10 h-10 animate-spin text-[#8B1A1A] mb-4" />
        <p className="font-bold text-slate-400 uppercase tracking-widest text-xs italic">Verificando segurança...</p>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
