"use client"

import { useState, useEffect } from "react"
import { Shield, UserCog, Mail, Calendar, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { api } from "@/services/api"
import { Profile } from "@/types/database"
import { useAuth } from "@/contexts/AuthContext"
import { useRouter } from "next/navigation"

export default function UsersPage() {
  const { user: currentUser, loading: authLoading } = useAuth()
  const router = useRouter()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && currentUser && currentUser.role !== 'ADMIN') {
      router.push('/')
    }
  }, [currentUser, authLoading, router])

  const loadProfiles = async () => {
    try {
      setLoading(true)
      const data = await api.getProfiles()
      setProfiles(data)
    } catch (error) {
      console.error("Erro ao carregar perfis:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (currentUser?.role === 'ADMIN') {
      const timer = setTimeout(() => {
        loadProfiles()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [currentUser])

  const handleRoleChange = async (userId: string, newRole: Profile['role']) => {
    try {
      setUpdatingId(userId)
      await api.updateProfileRole(userId, newRole)
      await loadProfiles()
    } catch (error) {
      console.error("Erro ao atualizar papel:", error)
      alert("Falha ao atualizar permissão.")
    } finally {
      setUpdatingId(null)
    }
  }

  if (authLoading || (currentUser && currentUser.role !== 'ADMIN')) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="w-10 h-10 animate-spin text-[#8B1A1A] mb-4" />
        <p className="font-bold text-slate-400 uppercase tracking-widest text-xs italic">Validando credenciais de administrador...</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
            <UserCog className="w-8 h-8 mr-3 text-[#8B1A1A]" />
            Gestão de Acessos Antares
          </h1>
          <p className="text-slate-500 font-medium mt-1">Controle de níveis de segurança e permissões da plataforma.</p>
        </div>
        <div className="bg-red-50 text-[#8B1A1A] px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border border-red-100">
          Acesso Restrito ao Administrador
        </div>
      </div>

      <div className="grid gap-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest italic">Sincronizando Perfis...</p>
          </div>
        ) : (
          profiles.map((profile) => (
            <div 
              key={profile.id} 
              className={`bg-white border ${profile.id === currentUser?.id ? 'border-[#8B1A1A]/30 bg-red-50/10' : 'border-slate-200'} rounded-2xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 shadow-sm hover:shadow-md transition-all group`}
            >
              <div className="flex items-center gap-4 flex-1">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-black ${
                  profile.role === 'ADMIN' ? 'bg-[#8B1A1A] text-white' : 
                  profile.role === 'DIRETORIA' ? 'bg-slate-800 text-white' : 
                  'bg-slate-100 text-slate-600'
                }`}>
                  {profile.full_name?.charAt(0).toUpperCase() || profile.email?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-800 text-lg tracking-tight">
                      {profile.full_name || "Usuário Sem Nome"}
                      {profile.id === currentUser?.id && (
                        <span className="ml-2 text-[10px] bg-[#8B1A1A]/10 text-[#8B1A1A] px-2 py-0.5 rounded uppercase font-black tracking-widest italic">Você</span>
                      )}
                    </h3>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-y-1 sm:gap-x-4 mt-1 text-slate-400 text-xs font-medium">
                    <span className="flex items-center"><Mail className="w-3 h-3 mr-1" /> {profile.email}</span>
                    <span className="flex items-center"><Calendar className="w-3 h-3 mr-1" /> {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : 'N/A'}</span>
                  </div>
                </div>
              </div>

              <div className="w-full md:w-auto flex flex-col sm:flex-row items-center gap-3">
                <div className="w-full sm:w-auto relative">
                  <select 
                    value={profile.role}
                    disabled={updatingId === profile.id || profile.id === currentUser?.id}
                    onChange={(e) => handleRoleChange(profile.id, e.target.value as Profile['role'])}
                    title="Alterar permissão"
                    className={`w-full sm:w-48 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest focus:outline-none focus:border-[#8B1A1A] transition-all appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      profile.role === 'ADMIN' ? 'text-[#8B1A1A]' : 'text-slate-600'
                    }`}
                  >
                    <option value="ADMIN">Administrador</option>
                    <option value="ALMOXARIFE">Almoxarife</option>
                    <option value="DIRETORIA">Diretoria</option>
                  </select>
                  <Shield className="w-3 h-3 absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
                </div>
                
                {updatingId === profile.id ? (
                  <Loader2 className="w-5 h-5 animate-spin text-[#8B1A1A]" />
                ) : (
                  <CheckCircle2 className={`w-5 h-5 ${profile.id === currentUser?.id ? 'text-green-500' : 'text-slate-200'}`} />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="bg-slate-50 rounded-2xl p-5 sm:p-8 border-2 border-dashed border-slate-200 flex flex-col sm:flex-row items-start gap-4">
        <div className="p-3 bg-amber-50 rounded-xl">
          <AlertCircle className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <h4 className="font-black text-slate-800 uppercase tracking-tighter text-sm mb-1">Dica de Segurança</h4>
          <p className="text-xs text-slate-500 leading-relaxed font-medium">
            Alterar o nível de acesso de um colaborador impacta instantaneamente quais módulos ele poderá visualizar e editar. 
            Certifique-se de validar a necessidade do usuário antes de conceder permissões de **Administrador**.
          </p>
        </div>
      </div>
    </div>
  )
}
