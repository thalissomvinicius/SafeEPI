"use client"

import { useMemo, useState } from "react"
import type React from "react"
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, UserRoundCog } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/services/api"
import { useAuth } from "@/contexts/AuthContext"

export default function AccountPage() {
  const { user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPasswords, setShowPasswords] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const passwordScore = useMemo(() => {
    let score = 0
    if (newPassword.length >= 8) score += 1
    if (/[A-Z]/.test(newPassword)) score += 1
    if (/[0-9]/.test(newPassword)) score += 1
    if (/[^A-Za-z0-9]/.test(newPassword)) score += 1
    return score
  }, [newPassword])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (newPassword.length < 8) {
      toast.error("A nova senha precisa ter pelo menos 8 caracteres.")
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error("A confirmação não confere com a nova senha.")
      return
    }

    if (currentPassword === newPassword) {
      toast.error("A nova senha precisa ser diferente da senha atual.")
      return
    }

    setIsSubmitting(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      toast.success("Senha alterada com sucesso.")
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Nao foi possivel alterar a senha."
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#2563EB]">Segurança da conta</p>
            <h1 className="mt-1 flex items-center gap-3 text-2xl font-black uppercase tracking-tighter text-slate-800 md:text-4xl">
              <UserRoundCog className="h-8 w-8 text-[#2563EB]" />
              Minha Conta
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-slate-500">
              Atualize sua senha de acesso sem depender do administrador da empresa.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Usuário logado</p>
            <p className="mt-1 max-w-[280px] truncate text-sm font-black text-slate-800">{user?.user_metadata?.full_name || user?.email}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#2563EB]">{user?.role}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[#2563EB]">
              <KeyRound className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-black uppercase tracking-tight text-slate-800">Alterar senha</h2>
              <p className="text-xs font-medium text-slate-500">Informe sua senha atual para confirmar a alteração.</p>
            </div>
          </div>

          <div className="space-y-4">
            <PasswordInput
              label="Senha atual"
              value={currentPassword}
              onChange={setCurrentPassword}
              visible={showPasswords}
              placeholder="Digite sua senha atual"
            />
            <PasswordInput
              label="Nova senha"
              value={newPassword}
              onChange={setNewPassword}
              visible={showPasswords}
              placeholder="Mínimo de 8 caracteres"
            />
            <PasswordInput
              label="Confirmar nova senha"
              value={confirmPassword}
              onChange={setConfirmPassword}
              visible={showPasswords}
              placeholder="Repita a nova senha"
            />

            <button
              type="button"
              onClick={() => setShowPasswords((current) => !current)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50"
            >
              {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showPasswords ? "Ocultar senhas" : "Mostrar senhas"}
            </button>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Força da nova senha</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{passwordScore}/4</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className={`h-2 rounded-full ${index < passwordScore ? "bg-[#2563EB]" : "bg-slate-100"}`}
                />
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-5 py-4 text-xs font-black uppercase tracking-widest text-white shadow-md transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Salvar nova senha
          </button>
        </form>

        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-black uppercase tracking-tight text-slate-800">Boas práticas</h2>
          <div className="mt-4 space-y-3 text-sm font-medium leading-relaxed text-slate-500">
            <p>Use uma senha diferente da provisória enviada pelo administrador.</p>
            <p>Prefira pelo menos 8 caracteres, misturando letras, números e símbolos.</p>
            <p>Não compartilhe senha por WhatsApp, e-mail ou anotações visíveis.</p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function PasswordInput({
  label,
  value,
  onChange,
  visible,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  visible: boolean
  placeholder: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <input
        type={visible ? "text" : "password"}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition-colors focus:border-[#2563EB]"
        placeholder={placeholder}
      />
    </label>
  )
}
