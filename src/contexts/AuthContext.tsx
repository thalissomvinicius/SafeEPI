"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { api } from "@/services/api"
import { useRouter, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabase"
import type { Company } from "@/types/database"
import { applyCompanyBrand, clearCompanyTheme } from "@/lib/brandTheme"
import { LoadingState } from "@/components/ui/LoadingState"
import type { Session } from "@supabase/supabase-js"

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
  signIn: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => { throw new Error("Autenticacao indisponivel.") },
  logout: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const router = useRouter()
  const pathname = usePathname()
  const hydrationGenerationRef = useRef(0)
  const hydrationRequestRef = useRef<Promise<User | null> | null>(null)
  const signingInRef = useRef(false)
  const currentUserRef = useRef<User | null>(null)

  const isPublicPath = useCallback((path: string | null) => {
    return ["/login", "/cadastro", "/esqueci-senha", "/unauthorized"].includes(path || "") ||
      /^\/(delivery\/remote|training\/remote|capture)(\/|$)/.test(path || "")
  }, [])

  const publicPath = isPublicPath(pathname)

  const hydrateUser = useCallback((preserveCurrentUser = false, authenticatedSession?: Session, propagateErrors = false): Promise<User | null> => {
    if (hydrationRequestRef.current) return hydrationRequestRef.current
    const generation = ++hydrationGenerationRef.current
    setAuthError(null)
    if (!preserveCurrentUser) setLoading(true)

    const request = (async () => {
      try {
        const session = authenticatedSession || await api.getSession()
        if (generation !== hydrationGenerationRef.current) return null

        if (!session) {
          if (generation === hydrationGenerationRef.current) {
            api.resetCompanyContext()
            currentUserRef.current = null
            setUser(null)
          }
          return null
        }

        const profile = await api.getCurrentUser()
        if (generation !== hydrationGenerationRef.current) return null

        if (profile.role === "MASTER") {
          const storedCompanyId = api.getMasterCompanyContext()

          if (storedCompanyId) {
            api.setMasterCompanyContext(storedCompanyId)
          } else {
            const companies = await api.getCompanies()
            if (generation !== hydrationGenerationRef.current) return null
            const defaultCompany = companies.find((company) => company.active !== false) || companies[0] || null
            api.setMasterCompanyContext(defaultCompany?.id || null)
          }
        } else {
          api.primeCompanyContext(profile)
        }

        if (generation !== hydrationGenerationRef.current) return null

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

        currentUserRef.current = userData as User
        setUser(userData as User)
        return userData as User
      } catch (error) {
        console.error("Auth error:", error)
        if (generation === hydrationGenerationRef.current) {
          if (!preserveCurrentUser || !currentUserRef.current) {
            currentUserRef.current = null
            setUser(null)
            setAuthError(error instanceof Error ? error.message : "Nao foi possivel validar seu acesso.")
          }
        }
        if (propagateErrors) throw error
        return null
      } finally {
        if (generation === hydrationGenerationRef.current) {
          hydrationRequestRef.current = null
          setLoading(false)
        }
      }
    })()
    hydrationRequestRef.current = request
    return request
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    if (signingInRef.current) return
    signingInRef.current = true
    // Invalidate an anonymous initial hydration before starting a new session.
    hydrationGenerationRef.current += 1
    hydrationRequestRef.current = null
    setLoading(true)
    setAuthError(null)
    try {
      const { session } = await api.login(email, password)
      if (!session) throw new Error("Nao foi possivel manter sua sessao.")
      const resolvedUser = await hydrateUser(false, session, true)
      if (!resolvedUser) throw new Error("Nao foi possivel validar seu acesso. Tente novamente.")
    } finally {
      signingInRef.current = false
      setLoading(false)
    }
  }, [hydrateUser])

  useEffect(() => {
    let deferredSync: number | undefined
    const initialSync = window.setTimeout(() => {
      if (!signingInRef.current) void hydrateUser()
    }, 0)

    const handleExplicitAuthSync = () => {
      if (!signingInRef.current) void hydrateUser(!!currentUserRef.current)
    }

    window.addEventListener("safeepi:auth-sync", handleExplicitAuthSync)

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return

      if (event === "SIGNED_OUT") {
        hydrationGenerationRef.current += 1
        hydrationRequestRef.current = null
        api.resetCompanyContext()
        currentUserRef.current = null
        setUser(null)
        setAuthError(null)
        setLoading(false)
        return
      }

      if (signingInRef.current) return
      // A refreshed token does not change trusted company membership or roles.
      // Avoid blocking navigation with a full profile reload on focus/refresh.
      if (event === "TOKEN_REFRESHED" && currentUserRef.current) return
      if (event === "SIGNED_IN" && session?.user.id === currentUserRef.current?.id) return
      window.clearTimeout(deferredSync)
      deferredSync = window.setTimeout(() => {
        void hydrateUser(!!currentUserRef.current)
      }, 0)
    })

    return () => {
      window.clearTimeout(initialSync)
      window.clearTimeout(deferredSync)
      hydrationGenerationRef.current += 1
      hydrationRequestRef.current = null
      window.removeEventListener("safeepi:auth-sync", handleExplicitAuthSync)
      subscription.unsubscribe()
    }
  }, [hydrateUser])

  useEffect(() => {
    if (loading) return

    if (!user && !publicPath && !authError) {
      const destination = `${pathname || "/"}${window.location.search}`
      router.replace(`/login?redirectTo=${encodeURIComponent(destination)}`)
    }
  }, [authError, loading, pathname, publicPath, router, user])

  useEffect(() => {
    const isLogin = pathname === "/login"

    // Preserve the pre-paint company color while the verified session hydrates.
    if (loading && !user && !isLogin) return

    if (!user || isLogin) {
      clearCompanyTheme()
      return
    }

    if (user.role === "MASTER") return
    void applyCompanyBrand(user.company, { enableTheme: true })
  }, [loading, pathname, user])

  const logout = async () => {
    try {
      await api.logout()
      currentUserRef.current = null
      setUser(null)
      router.replace("/login")
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  if (!publicPath && (loading || !user)) {
    if (authError && !loading) {
      return (
        <main id="main-content" className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-6">
          <div role="alert" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Não foi possível abrir seu painel</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{authError}</p>
            <button type="button" onClick={() => void hydrateUser()} className="mt-6 min-h-12 w-full rounded-xl bg-slate-900 px-5 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2">Tentar novamente</button>
          </div>
        </main>
      )
    }
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
    <AuthContext.Provider value={{ user, loading, signIn, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
