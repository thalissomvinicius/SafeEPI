"use client"

import { useState, useEffect } from "react"
import { Shield, UserCog, Mail, Calendar, Loader2, AlertCircle, Plus, Key, Trash2 } from "lucide-react"
import { api } from "@/services/api"
import { Profile } from "@/types/database"
import { useAuth } from "@/contexts/AuthContext"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export default function UsersPage() {
  const { user: currentUser, loading: authLoading } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<(Profile & { email: string; created_at: string; last_sign_in_at: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    id: "",
    full_name: "",
    email: "",
    password: "",
    role: "ALMOXARIFE"
  })
  const canManageUsers = currentUser ? ['ADMIN', 'MASTER'].includes(currentUser.role || '') : false
  const masterCompanyId = currentUser?.role === 'MASTER' ? api.getMasterCompanyContext() || undefined : undefined

  useEffect(() => {
    if (!authLoading && currentUser && !canManageUsers) {
      router.push('/')
    }
  }, [authLoading, canManageUsers, currentUser, router])

  const loadUsers = async () => {
    try {
      setLoading(true)
      const data = await api.getUsers(masterCompanyId)
      setUsers(data)
    } catch (error) {
      console.error("Erro ao carregar usuários:", error)
      toast.error("Erro ao carregar lista de usuários.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canManageUsers) {
      const timer = setTimeout(() => {
        loadUsers()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [canManageUsers, currentUser])

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      setUpdatingId(userId)
      await api.updateUser({ id: userId, role: newRole, company_id: masterCompanyId })
      toast.success("Permissão atualizada com sucesso.")
      await loadUsers()
    } catch (error) {
      console.error("Erro ao atualizar papel:", error)
      toast.error("Falha ao atualizar permissão.")
    } finally {
      setUpdatingId(null)
    }
  }

  const handleDelete = async (userId: string) => {
    if (!confirm("Tem certeza que deseja excluir este usuário definitivamente?")) return;
    try {
      setUpdatingId(userId)
      await api.deleteUser(userId, masterCompanyId)
      toast.success("Usuário excluído com sucesso.")
      await loadUsers()
    } catch (error) {
      console.error("Erro ao excluir:", error)
      toast.error("Falha ao excluir usuário.")
    } finally {
      setUpdatingId(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      if (formData.id) {
        // Update user (password reset)
        if (!formData.password) {
            toast.error("Digite a nova senha.")
            setIsSubmitting(false)
            return
        }
        await api.updateUser({ id: formData.id, password: formData.password, company_id: masterCompanyId })
        toast.success("Senha atualizada com sucesso.")
      } else {
        // Create user
        if (!formData.password || formData.password.length < 6) {
          toast.error("A senha deve ter pelo menos 6 caracteres.")
          setIsSubmitting(false)
          return
        }
        await api.createUser({ ...formData, company_id: masterCompanyId })
        toast.success("Usuário criado com sucesso!")
      }
      setIsModalOpen(false)
      loadUsers()
    } catch (error: unknown) {
      console.error("Erro no form:", error)
      const message = error instanceof Error ? error.message : "Erro ao salvar usuário."
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openNewUserModal = () => {
    setFormData({ id: "", full_name: "", email: "", password: "", role: "ALMOXARIFE" })
    setIsModalOpen(true)
  }

  const openResetPasswordModal = (user: (typeof users)[number]) => {
    setFormData({ id: user.id, full_name: user.full_name ?? "", email: user.email, password: "", role: user.role ?? "ALMOXARIFE" })
    setIsModalOpen(true)
  }

  if (authLoading || (currentUser && !canManageUsers)) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="w-10 h-10 animate-spin text-[#2563EB] mb-4" />
        <p className="font-bold text-slate-400 uppercase tracking-widest text-xs italic">Validando credenciais de administrador...</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
            <UserCog className="w-8 h-8 mr-3 text-[#2563EB]" />
            Gestão de Acessos SafeEPI
          </h1>
          <p className="text-slate-500 font-medium mt-1">Controle de níveis de segurança, senhas e permissões da plataforma.</p>
        </div>
        <div className="flex items-center gap-4">
            <div className="hidden sm:block bg-blue-50 text-[#2563EB] px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border border-blue-100">
            Acesso Restrito
            </div>
            <button 
                onClick={openNewUserModal}
                className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-5 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-md flex items-center gap-2"
            >
                <Plus className="w-4 h-4" /> Novo Usuário
            </button>
        </div>
      </div>

      <div className="grid gap-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest italic">Sincronizando Perfis do Auth...</p>
          </div>
        ) : (
          users.map((user) => (
            <div 
              key={user.id} 
              className={`bg-white border ${user.id === currentUser?.id ? 'border-[#2563EB]/30 bg-blue-50/30' : 'border-slate-200'} rounded-2xl p-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 shadow-sm hover:shadow-md transition-all group`}
            >
              <div className="flex items-center gap-4 flex-1">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-black shrink-0 ${
                  user.role === 'ADMIN' ? 'bg-[#2563EB] text-white' : 
                  user.role === 'DIRETORIA' ? 'bg-slate-800 text-white' : 
                  'bg-slate-100 text-slate-600'
                }`}>
                  {user.full_name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-800 text-lg tracking-tight">
                      {user.full_name || "Usuário Sem Nome"}
                      {user.id === currentUser?.id && (
                        <span className="ml-2 text-[10px] bg-[#2563EB]/10 text-[#2563EB] px-2 py-0.5 rounded uppercase font-black tracking-widest italic">Você</span>
                      )}
                    </h3>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-y-1 sm:gap-x-4 mt-1 text-slate-400 text-xs font-medium">
                    <span className="flex items-center"><Mail className="w-3 h-3 mr-1" /> {user.email}</span>
                    <span className="flex items-center"><Calendar className="w-3 h-3 mr-1" /> Cadastro: {new Date(user.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              <div className="w-full lg:w-auto flex flex-wrap items-center gap-3 bg-slate-50 p-2 rounded-xl">
                <div className="w-full sm:w-auto relative flex-1">
                  <select 
                    value={user.role}
                    disabled={updatingId === user.id || user.id === currentUser?.id}
                    onChange={(e) => handleRoleChange(user.id, e.target.value)}
                    title="Alterar permissão"
                    className={`w-full sm:w-48 bg-white border border-slate-200 text-slate-900 rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-widest focus:outline-none focus:border-[#2563EB] transition-all appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      user.role === 'ADMIN' ? 'text-[#2563EB]' : 'text-slate-600'
                    }`}
                  >
                    <option value="ADMIN">Administrador</option>
                    <option value="ALMOXARIFE">Almoxarife</option>
                    <option value="DIRETORIA">Diretoria</option>
                  </select>
                  <Shield className="w-3 h-3 absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
                </div>
                
                <button
                    onClick={() => openResetPasswordModal(user)}
                    disabled={updatingId === user.id}
                    title="Redefinir Senha"
                    className="p-2 bg-white border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100 hover:text-slate-800 transition-colors disabled:opacity-50"
                >
                    <Key className="w-4 h-4" />
                </button>

                <button
                    onClick={() => handleDelete(user.id)}
                    disabled={updatingId === user.id || user.id === currentUser?.id}
                    title="Excluir Usuário"
                    className="p-2 bg-white border border-blue-200 text-red-500 rounded-lg hover:bg-blue-50 hover:text-red-700 transition-colors disabled:opacity-50"
                >
                    <Trash2 className="w-4 h-4" />
                </button>

                {updatingId === user.id ? (
                  <Loader2 className="w-5 h-5 animate-spin text-[#2563EB]" />
                ) : (
                  <div className="w-5" />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Dica */}
      <div className="bg-slate-50 rounded-2xl p-5 sm:p-8 border-2 border-dashed border-slate-200 flex flex-col sm:flex-row items-start gap-4 mt-8">
        <div className="p-3 bg-amber-50 rounded-xl">
          <AlertCircle className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <h4 className="font-black text-slate-800 uppercase tracking-tighter text-sm mb-1">Políticas de Acesso da Plataforma</h4>
          <p className="text-xs text-slate-500 leading-relaxed font-medium">
            <strong className="text-slate-700">ADMIN:</strong> Acesso total. 
            <strong className="text-slate-700 ml-2">ALMOXARIFE:</strong> Opera entregas, baixas e estoque (Sem acesso a relatórios e usuários). 
            <strong className="text-slate-700 ml-2">DIRETORIA:</strong> Apenas visualiza relatórios e histórico (Não faz entregas).
          </p>
        </div>
      </div>

      {/* Modal de Criação / Edição */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-black uppercase tracking-tighter text-slate-800 flex items-center gap-2">
                {formData.id ? <><Key className="w-5 h-5 text-[#2563EB]" /> Redefinir Senha</> : <><UserCog className="w-5 h-5 text-[#2563EB]" /> Novo Usuário</>}
              </h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold p-2"
              >
                âœ•
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {!formData.id && (
                <>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Nome Completo</label>
                        <input 
                            type="text" required
                            value={formData.full_name}
                            onChange={e => setFormData({...formData, full_name: e.target.value})}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-[#2563EB] font-bold text-sm"
                            placeholder="Ex: João Silva"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">E-mail de Login</label>
                        <input 
                            type="email" required
                            value={formData.email}
                            onChange={e => setFormData({...formData, email: e.target.value})}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-[#2563EB] font-bold text-sm"
                            placeholder="joao@empresa.com.br"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Nível de Acesso (Inicial)</label>
                        <select 
                            value={formData.role}
                            title="Nível de Acesso"
                            onChange={e => setFormData({...formData, role: e.target.value})}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-[#2563EB] font-bold text-sm uppercase"
                        >
                            <option value="ADMIN">Administrador</option>
                            <option value="ALMOXARIFE">Almoxarife</option>
                            <option value="DIRETORIA">Diretoria</option>
                        </select>
                    </div>
                </>
              )}

              {formData.id && (
                  <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 mb-4">
                      <p className="text-xs font-bold text-orange-800 mb-1">{formData.full_name}</p>
                      <p className="text-[10px] text-orange-600 uppercase tracking-widest">{formData.email}</p>
                  </div>
              )}

              <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                      {formData.id ? 'Nova Senha' : 'Senha Provisória'}
                  </label>
                  <input 
                      type="password" required minLength={6}
                      value={formData.password}
                      onChange={e => setFormData({...formData, password: e.target.value})}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-[#2563EB] font-bold text-sm"
                      placeholder="Mínimo de 6 caracteres"
                  />
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-3 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-colors flex items-center justify-center disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (formData.id ? 'Salvar Senha' : 'Criar Conta')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
