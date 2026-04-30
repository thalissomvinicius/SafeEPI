"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { api } from "@/services/api"
import { useRouter, usePathname } from "next/navigation"
import { Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { Company } from "@/types/database"

type AppRole = "MASTER" | "ADMIN" | "ALMOXARIFE" | "DIRETORIA"

export type User = {
  id: string
  email?: string
  user_metadata?: {
    full_name?: string
    role?: AppRole
  }
  role?: AppRole
  company_id?: string | null
  company?: Company | null
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

  const isPublicPath = useCallback((path: string | null) => {
    return path === "/login" || path?.startsWith("/delivery/remote") || path?.startsWith("/training/remote") || path?.startsWith("/capture")
  }, [])

  const hydrateUser = useCallback(async () => {
    try {
      const session = await api.getSession()

      if (!session) {
        setUser(null)
        return
      }

      const profile = await api.getCurrentUser()
      const userData = {
        ...session.user,
        email: profile.email || session.user.email,
        role: profile.role,
        company_id: profile.company_id,
        company: profile.company,
        user_metadata: {
          ...session.user.user_metadata,
          full_name: profile.full_name || session.user.user_metadata?.full_name,
          role: profile.role,
        },
      }

      if (session.user.email === "thalissomvinicius7@gmail.com" || session.user.email === "thalissom.cruz@VALLE.br") {
        userData.role = "MASTER"
      }

      setUser(userData as User)
    } catch (error) {
      console.error("Auth error:", error)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialSync = window.setTimeout(() => {
      void hydrateUser()
    }, 0)

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void hydrateUser()
    })

    return () => {
      window.clearTimeout(initialSync)
      subscription.unsubscribe()
    }
  }, [hydrateUser])

  useEffect(() => {
    if (loading) return

    if (!user && !isPublicPath(pathname)) {
      router.replace("/login")
    }
  }, [isPublicPath, loading, pathname, router, user])

  const logout = async () => {
    try {
      await api.logout()
      setUser(null)
      router.replace("/login")
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  if (loading || (!user && !isPublicPath(pathname))) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-10 h-10 animate-spin text-[#2563EB] mb-4" />
        <p className="font-bold text-slate-400 uppercase tracking-widest text-xs italic">Verificando seguranca...</p>
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
