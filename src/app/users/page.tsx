// responsive: revisado — mobile-first ✓
"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Shield, UserCog, Mail, Calendar, Loader2, AlertCircle, Plus, Key, Trash2 } from "lucide-react"
import { api } from "@/services/api"
import { Profile } from "@/types/database"
import { useAuth } from "@/contexts/AuthContext"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { BottomSheet } from "@/components/ui/BottomSheet"
import { MobileTableCard } from "@/components/ui/MobileTableCard"
import { LoadingRows, LoadingState } from "@/components/ui/LoadingState"
import { AdminLoadError } from "@/components/ui/AdminLoadError"
import { Button } from "@/components/ui/button"

export default function UsersPage() {
  const { user: currentUser, loading: authLoading } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<(Profile & { email: string; created_at: string; last_sign_in_at: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadSequence = useRef(0)
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

  const loadUsers = useCallback(async () => {
    const sequence = ++loadSequence.current
    try {
      setLoading(true)
      setLoadError(null)
      const data = await api.getUsers(masterCompanyId)
      if (sequence !== loadSequence.current) return
      setUsers(data)
    } catch (error) {
      console.error("Erro ao carregar usuários:", error)
      if (sequence === loadSequence.current) setLoadError("Não foi possível atualizar os usuários. Os registros anteriores foram preservados.")
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [masterCompanyId])

  useEffect(() => {
    if (canManageUsers) {
      const timer = setTimeout(() => {
        loadUsers()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [canManageUsers, currentUser, loadUsers])

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
        if (!formData.password || formData.password.length < 8) {
          toast.error("A senha deve ter pelo menos 8 caracteres.")
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
      <LoadingState
        variant="page"
        label="Validando administrador"
        detail="Conferindo permissoes para gestao de acessos."
      />
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5 animate-in fade-in duration-200">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center">
            <UserCog className="w-6 h-6 mr-2 shrink-0 text-[#2563EB]" />
            Usuários e acesso
          </h1>
          <p className="text-sm text-slate-500 mt-1">Gerencie a equipe e as permissões da empresa.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
            <div className="hidden sm:block bg-blue-50 text-[#2563EB] px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border border-blue-100">
            Acesso Restrito
            </div>
            <button 
                onClick={openNewUserModal}
                className="min-h-11 w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-5 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-md flex items-center justify-center gap-2 sm:w-auto"
            >
                <Plus className="w-4 h-4" /> Novo Usuário
            </button>
        </div>
      </div>

      {loadError && <AdminLoadError message={loadError} retry={() => void loadUsers()} busy={loading} />}
      <div className="grid gap-4" aria-busy={loading}>
        {loading && users.length === 0 ? (
          <LoadingRows rows={5} />
        ) : (
          <>
          <div className="grid grid-cols-1 gap-4 md:hidden">
            {users.map((user) => (
              <MobileTableCard
                key={user.id}
                title={user.full_name || "Usuário Sem Nome"}
                subtitle={user.email}
                badge={{ label: user.role || "-", variant: user.role === "ADMIN" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600" }}
                expandable
                fields={[
                  { label: "Email", value: user.email },
                  { label: "Cadastro", value: new Date(user.created_at).toLocaleDateString() },
                  { label: "Permissão", value: user.role || "-" },
                ]}
                actions={
                  <div className="grid w-full grid-cols-[1fr_auto_auto] gap-2">
                    <select
                      value={user.role}
                      disabled={updatingId === user.id || user.id === currentUser?.id}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      title="Alterar permissão"
                      className="min-h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-2 text-sm font-medium text-slate-600 disabled:opacity-50"
                    >
                      <option value="ADMIN">Administrador</option>
                      <option value="ALMOXARIFE">Almoxarife</option>
                      <option value="DIRETORIA">Diretoria</option>
                    </select>
                    <button aria-label={`Redefinir senha de ${user.full_name || user.email}`} onClick={() => openResetPasswordModal(user)} disabled={updatingId === user.id} className="flex min-h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500">
                      <Key className="h-4 w-4" />
                    </button>
                    <button aria-label={`Excluir usuário ${user.full_name || user.email}`} onClick={() => handleDelete(user.id)} disabled={updatingId === user.id || user.id === currentUser?.id} className="flex min-h-11 w-11 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-600 disabled:opacity-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                }
              />
            ))}
          </div>
          <div className="hidden grid-cols-1 gap-4 md:grid">
          {users.map((user) => (
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
          ))}
          </div>
          </>
        )}
      </div>

      {!loading && !loadError && users.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Nenhum usuário cadastrado nesta empresa.</p>}

      {/* Dica */}
      <div className="bg-slate-50 rounded-2xl p-5 sm:p-8 border-2 border-dashed border-slate-200 flex flex-col sm:flex-row items-start gap-4 mt-8">
        <div className="p-3 bg-amber-50 rounded-xl">
          <AlertCircle className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <h4 className="font-black text-slate-800 uppercase tracking-tighter text-sm mb-1">Políticas de Acesso da Plataforma</h4>
          <p className="text-xs text-slate-500 leading-relaxed font-medium">
            <strong className="text-slate-700">ADMIN:</strong> Gerencia a operação e os acessos da própria empresa.
            <strong className="text-slate-700 ml-2">ALMOXARIFE:</strong> Opera entregas, baixas, estoque e cadastro de EPIs/CAs (Sem acesso a relatórios e usuários). 
            <strong className="text-slate-700 ml-2">DIRETORIA:</strong> Apenas visualiza relatórios e histórico (Não faz entregas).
          </p>
        </div>
      </div>

      {/* Modal de Criação / Edição */}
      <BottomSheet
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={formData.id ? "Redefinir Senha" : "Novo Usuário"}
        className="md:max-w-md"
      >
            <form onSubmit={handleSubmit} className="space-y-4">
              {!formData.id && (
                <>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Nome Completo</label>
                        <input 
                            type="text" required
                            value={formData.full_name}
                            onChange={e => setFormData({...formData, full_name: e.target.value})}
                            className="min-h-11 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-[#2563EB] font-bold text-sm"
                            placeholder="Ex: João Silva"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">E-mail de Login</label>
                        <input 
                            type="email" required
                            inputMode="email"
                            value={formData.email}
                            onChange={e => setFormData({...formData, email: e.target.value})}
                            className="min-h-11 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-[#2563EB] font-bold text-sm"
                            placeholder="joao@empresa.com.br"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Nível de Acesso (Inicial)</label>
                        <select 
                            value={formData.role}
                            title="Nível de Acesso"
                            onChange={e => setFormData({...formData, role: e.target.value})}
                            className="min-h-11 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-[#2563EB] font-bold text-sm uppercase"
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
                      type="password" required minLength={8}
                      autoComplete="new-password"
                      value={formData.password}
                      onChange={e => setFormData({...formData, password: e.target.value})}
                      className="min-h-11 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-[#2563EB] font-bold text-sm"
                      placeholder="Mínimo de 8 caracteres"
                  />
              </div>

              <div className="pt-4 flex flex-col gap-3 md:flex-row">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  loadingText={formData.id ? "Salvando…" : "Criando conta…"}
                  className="h-auto min-h-11 flex-1 px-4 py-3 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-colors flex items-center justify-center disabled:opacity-50"
                >
                  {formData.id ? 'Salvar Senha' : 'Criar Conta'}
                </Button>
              </div>
            </form>
      </BottomSheet>
    </div>
  )
}
