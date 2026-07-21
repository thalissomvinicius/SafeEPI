"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { api } from "@/services/api"
import { useRouter, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabase"
import type { Company } from "@/types/database"
import { applyCompanyBrand, clearCompanyTheme } from "@/lib/brandTheme"
import { LoadingState } from "@/components/ui/LoadingState"

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
  const hydrationGenerationRef = useRef(0)

  const isPublicPath = useCallback((path: string | null) => {
    return path === "/login" || path?.startsWith("/delivery/remote") || path?.startsWith("/training/remote") || path?.startsWith("/capture")
  }, [])

  const publicPath = isPublicPath(pathname)

  const hydrateUser = useCallback(async (preserveCurrentUser = false) => {
    const generation = ++hydrationGenerationRef.current

    try {
      const session = await api.getSession()

      if (!session) {
        if (generation === hydrationGenerationRef.current) {
          api.resetCompanyContext()
          setUser(null)
        }
        return
      }

      const profile = await api.getCurrentUser()

      if (profile.role === "MASTER") {
        const storedCompanyId = api.getMasterCompanyContext()

        if (storedCompanyId) {
          api.setMasterCompanyContext(storedCompanyId)
        } else {
          const companies = await api.getCompanies()
          const defaultCompany = companies.find((company) => company.active !== false) || companies[0] || null
          api.setMasterCompanyContext(defaultCompany?.id || null)
        }
      } else {
        api.primeCompanyContext(profile)
      }

      if (generation !== hydrationGenerationRef.current) return

      // O role é definido SOMENTE pelo backend (/api/me), que lê de
      // fontes confiáveis (app_metadata / company_users / profiles).
      // Nunca fazer override por e-mail aqui — qualquer bypass de UI
      // é meramente cosmético e mascara falhas reais de autorização.
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

      setUser(userData as User)
    } catch (error) {
      console.error("Auth error:", error)
      if (generation === hydrationGenerationRef.current) {
        setUser((currentUser) => preserveCurrentUser ? currentUser : null)
      }
    } finally {
      if (generation === hydrationGenerationRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const initialSync = window.setTimeout(() => {
      void hydrateUser()
    }, 0)

    const handleExplicitAuthSync = () => {
      void hydrateUser()
    }

    window.addEventListener("safeepi:auth-sync", handleExplicitAuthSync)

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return

      if (event === "SIGNED_OUT") {
        hydrationGenerationRef.current += 1
        api.resetCompanyContext()
        setUser(null)
        setLoading(false)
        return
      }

      void hydrateUser(event === "TOKEN_REFRESHED" || event === "USER_UPDATED")
    })

    return () => {
      window.clearTimeout(initialSync)
      window.removeEventListener("safeepi:auth-sync", handleExplicitAuthSync)
      subscription.unsubscribe()
    }
  }, [hydrateUser])

  useEffect(() => {
    if (loading) return

    if (!user && !publicPath) {
      router.replace("/login")
    }
  }, [loading, publicPath, router, user])

  useEffect(() => {
    const isLogin = pathname === "/login"

    if (!user || isLogin) {
      clearCompanyTheme()
      return
    }

    if (user.role === "MASTER") return
    void applyCompanyBrand(user.company, { enableTheme: true })
  }, [pathname, user])

  const logout = async () => {
    try {
      await api.logout()
      setUser(null)
      router.replace("/login")
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  if (!publicPath && (loading || !user)) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50">
        <LoadingState
          variant="page"
          label="Verificando seguranca"
          detail="Validando sessao, empresa e permissoes de acesso."
          className="min-h-[100dvh]"
        />
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
