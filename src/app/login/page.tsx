"use client"

import { useState } from "react"
import { ShieldCheck, Loader2 } from "lucide-react"
import { api } from "@/services/api"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")
    
    if (!email || !password) {
      setErrorMsg("Preencha todos os campos.")
      return
    }

    try {
      setLoading(true)
      await api.login(email, password)
      router.push("/") // Redireciona para o painel
    } catch (err) {
      const error = err as Error
      console.error("Login failed:", error)
      setErrorMsg(error.message || "Credenciais inválidas. Tente novamente.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 overflow-y-auto relative py-12">
      {/* Background Decorativo */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#8B1A1A]/20 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-md p-5 sm:p-8 relative z-10 animate-in fade-in zoom-in-95 duration-700">
        <div className="text-center mb-10">
          <div className="mx-auto w-16 h-16 bg-[#8B1A1A] p-3 rounded-2xl shadow-xl shadow-red-900/50 mb-6 flex items-center justify-center transform rotate-12 hover:rotate-0 transition-all duration-300">
            <ShieldCheck className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter">
            Antares <span className="text-[#8B1A1A]">SESMT</span>
          </h1>
          <p className="text-slate-400 text-sm mt-3 font-medium uppercase tracking-[0.2em]">Autenticação Restrita</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-6 sm:p-8 rounded-3xl shadow-2xl">
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-widest text-center rounded-xl animate-in shake">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="block text-[10px] font-black text-slate-300 uppercase tracking-widest">E-mail Corporativo</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-2xl px-5 py-4 text-sm focus:border-[#8B1A1A] focus:bg-slate-900 transition-all font-bold placeholder:font-normal placeholder:text-slate-600 outline-none"
                placeholder="nome@antares.com.br"
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <label className="block text-[10px] font-black text-slate-300 uppercase tracking-widest">Senha de Acesso</label>
              </div>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-2xl px-5 py-4 text-sm focus:border-[#8B1A1A] focus:bg-slate-900 transition-all font-bold placeholder:font-normal placeholder:text-slate-600 outline-none"
                placeholder="••••••••"
                required
              />
            </div>

            <div className="pt-4">
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-[#8B1A1A] hover:bg-[#681313] text-white py-5 rounded-2xl font-black uppercase tracking-[0.2em] transition-all shadow-2xl shadow-red-900/40 border-b-4 border-red-950 flex items-center justify-center disabled:opacity-70"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Iniciar Sessão"}
              </button>
            </div>
          </form>

          <div className="mt-8 pt-6 border-t border-white/5 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black italic">Ambiente Protegido NR-06</p>
          </div>
        </div>
      </div>
    </div>
  )
}
