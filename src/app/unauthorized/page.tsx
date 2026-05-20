// responsive: revisado — mobile-first ✓
import Link from "next/link"
import { ShieldAlert } from "lucide-react"

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <section className="flex w-full max-w-md flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-[#2563EB]">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <p className="mt-6 text-sm font-black uppercase tracking-widest text-[#2563EB]">Acesso bloqueado</p>
        <h1 className="mt-2 text-2xl font-black uppercase tracking-tight text-slate-900 md:text-4xl">
          Sem permissao para esta area
        </h1>
        <p className="mt-3 text-sm font-medium leading-relaxed text-slate-500">
          Sua conta nao possui permissao para abrir esta pagina. Volte para o painel ou fale com um administrador.
        </p>
        <Link
          href="/"
          className="mt-8 flex min-h-11 w-full items-center justify-center rounded-xl bg-[#2563EB] px-5 py-3 text-sm font-black uppercase tracking-widest text-white shadow-md shadow-blue-900/15 transition-colors hover:bg-[#1D4ED8] md:w-auto"
        >
          Voltar ao painel
        </Link>
      </section>
    </main>
  )
}
