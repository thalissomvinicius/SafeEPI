import Link from "next/link"

export default function UnauthorizedPage() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-red-700">Acesso restrito</p>
        <h1 className="mt-3 text-2xl font-black text-slate-900">Sem permissao para acessar esta area.</h1>
        <p className="mt-3 text-sm font-medium leading-6 text-slate-500">
          Sua sessao esta ativa, mas o perfil atual nao tem permissao administrativa para este recurso.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-red-800 px-5 text-sm font-black uppercase tracking-wider text-white shadow-sm"
        >
          Voltar ao painel
        </Link>
      </section>
    </main>
  )
}
