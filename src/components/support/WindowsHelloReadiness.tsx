"use client"

import { useState } from "react"
import { CheckCircle2, Fingerprint, Loader2, ShieldAlert, Usb } from "lucide-react"

import {
  detectDeviceBiometricReadiness,
  type DeviceBiometricReadiness,
} from "@/lib/deviceBiometric"

const READINESS_COPY: Record<
  DeviceBiometricReadiness["code"],
  { title: string; description: string; className: string }
> = {
  available: {
    title: "Windows Hello disponível neste computador",
    description:
      "O navegador encontrou um autenticador local. Isso confirma a compatibilidade do Windows Hello, mas não identifica sozinho qual leitor ou qual funcionário usou a digital.",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  insecure_context: {
    title: "Abra o SafeEPI em uma conexão HTTPS",
    description:
      "A verificação do Windows Hello é bloqueada em páginas sem conexão segura. Use o endereço oficial do SafeEPI na Vercel.",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  webauthn_unsupported: {
    title: "Navegador sem suporte ao Windows Hello",
    description:
      "Atualize o Microsoft Edge ou o Google Chrome no Windows 10/11 e tente novamente.",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  platform_authenticator_unavailable: {
    title: "Windows Hello ainda não está disponível",
    description:
      "Conecte o leitor USB, instale o driver e cadastre uma digital nas Opções de entrada do Windows antes de repetir o teste.",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  check_failed: {
    title: "Não foi possível concluir a verificação",
    description:
      "O navegador recusou ou interrompeu o diagnóstico. Confirme as permissões, o driver e a configuração do Windows Hello.",
    className: "border-red-200 bg-red-50 text-red-800",
  },
}

export function WindowsHelloReadiness() {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<DeviceBiometricReadiness | null>(null)

  const runCheck = async () => {
    setChecking(true)
    setResult(null)

    const publicKeyCredential = window.PublicKeyCredential
    const checkPlatformAuthenticator =
      publicKeyCredential &&
      typeof publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
        ? () => publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        : undefined

    const readiness = await detectDeviceBiometricReadiness({
      secureContext: window.isSecureContext,
      checkPlatformAuthenticator,
    })

    setResult(readiness)
    setChecking(false)
  }

  const copy = result ? READINESS_COPY[result.code] : null

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="windows-hello-title">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#2563EB]">
            <Fingerprint className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2563EB]">Diagnóstico do equipamento</p>
            <h2 id="windows-hello-title" className="mt-1 text-xl font-black tracking-tight text-slate-800">
              Leitor USB / Windows Hello
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Verifique se este computador está pronto para reconhecer um autenticador do Windows Hello. O teste não captura nem armazena a impressão digital.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={runCheck}
          disabled={checking}
          className="inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-5 py-3 text-sm font-black text-white shadow-md transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70 sm:w-auto"
        >
          {checking ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Usb className="h-5 w-5" aria-hidden="true" />}
          {checking ? "Verificando..." : "Verificar neste PC"}
        </button>
      </div>

      {copy && result && (
        <div className={`mt-5 flex gap-3 rounded-2xl border p-4 ${copy.className}`} role="status" aria-live="polite">
          {result.code === "available" ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <div>
            <p className="text-sm font-black">{copy.title}</p>
            <p className="mt-1 text-sm leading-5 opacity-90">{copy.description}</p>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-3 text-xs text-slate-600 sm:grid-cols-3">
        <p className="rounded-xl bg-slate-50 p-3"><strong className="mb-1 block text-slate-800">1. Conecte</strong>Use o leitor em uma porta USB do computador.</p>
        <p className="rounded-xl bg-slate-50 p-3"><strong className="mb-1 block text-slate-800">2. Cadastre</strong>Configure a digital nas Opções de entrada do Windows.</p>
        <p className="rounded-xl bg-slate-50 p-3"><strong className="mb-1 block text-slate-800">3. Verifique</strong>Abra esta tela no Edge ou Chrome e execute o teste.</p>
      </div>

      <p className="mt-4 text-xs leading-5 text-slate-500">
        Importante: Windows Hello comprova que o dispositivo foi desbloqueado por um método autorizado no Windows. Sem SDK próprio do fabricante, ele não fornece ao SafeEPI a imagem da digital nem identifica juridicamente o colaborador.
      </p>
    </section>
  )
}
