"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Search, User, Shield, HardDrive, X, Loader2, ArrowRight } from "lucide-react"
import { api, type GlobalSearchResults } from "@/services/api"
import { useRouter } from "next/navigation"
import { useDialogAccessibility } from "@/hooks/useDialogAccessibility"

const EMPTY_RESULTS: GlobalSearchResults = { employees: [], ppes: [], workplaces: [] }

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GlobalSearchResults>(EMPTY_RESULTS)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const resultsId = useId()
  const closeSearch = useCallback(() => {
    setIsOpen(false)
    setLoading(false)
  }, [])
  const dialogRef = useDialogAccessibility<HTMLDivElement>(isOpen, closeSearch)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setIsOpen(true)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  useEffect(() => {
    if (!isOpen || query.trim().length < 2) {
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        setResults(await api.searchGlobal(query, controller.signal))
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Erro na busca global:", error)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [isOpen, query])

  const navigateTo = (path: string) => {
    closeSearch()
    setQuery("")
    router.push(path)
  }

  const moveResultFocus = (direction: 1 | -1) => {
    const buttons = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>("[data-search-result]") || [],
    )
    if (buttons.length === 0) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = current < 0
      ? (direction === 1 ? 0 : buttons.length - 1)
      : (current + direction + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  const resultCount = query.trim().length < 2
    ? 0
    : results.employees.length + results.ppes.length + results.workplaces.length

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#2563EB] lg:hidden"
        aria-label="Abrir busca global"
        title="Buscar"
      >
        <Search className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="group hidden h-10 w-52 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-500 transition-colors hover:border-[var(--brand-border)] hover:bg-white lg:flex xl:w-60"
        aria-label="Abrir busca global, atalho Control K"
      >
        <Search className="w-4 h-4 group-hover:text-[#2563EB] transition-colors" />
        <span className="flex-1 text-left text-xs font-medium">Buscar no sistema</span>
        <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-sans text-[10px]">Ctrl K</kbd>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center p-0 md:px-4 md:pt-20">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={closeSearch} aria-hidden="true" />

          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                moveResultFocus(event.key === "ArrowDown" ? 1 : -1)
              }
            }}
            className="bg-white w-full max-w-2xl md:rounded-3xl shadow-2xl z-[110] overflow-hidden animate-in zoom-in-95 md:slide-in-from-top-10 duration-300 flex flex-col border border-slate-100 h-[100dvh] md:h-auto"
          >
            <h2 id={titleId} className="sr-only">Busca global</h2>
            <div className="p-4 pt-[calc(env(safe-area-inset-top)+1rem)] md:p-6 border-b border-slate-100 flex items-center gap-2 md:gap-4">
              <Search className="w-5 h-5 md:w-6 md:h-6 text-[#2563EB]" aria-hidden="true" />
              <label htmlFor={`${resultsId}-input`} className="sr-only">Buscar colaboradores, EPIs ou locais</label>
              <input
                id={`${resultsId}-input`}
                ref={inputRef}
                type="search"
                placeholder="Buscar..."
                className="flex-1 bg-transparent border-none outline-none text-base md:text-lg font-bold text-slate-800 placeholder:text-slate-500"
                value={query}
                onChange={(event) => {
                  const nextQuery = event.target.value
                  setQuery(nextQuery)
                  if (nextQuery.trim().length < 2) {
                    setResults(EMPTY_RESULTS)
                    setLoading(false)
                  }
                }}
                role="combobox"
                aria-expanded={resultCount > 0}
                aria-controls={resultsId}
                aria-autocomplete="list"
              />
              {loading && <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-label="Buscando" />}
              <button type="button" onClick={closeSearch} aria-label="Fechar busca" className="min-h-11 min-w-11 p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div id={resultsId} className="flex-1 md:max-h-[500px] overflow-y-auto p-2" aria-live="polite">
              {query.trim().length < 2 ? (
                <div className="px-8 py-12 text-center text-slate-500"><p className="text-sm">Busque colaboradores, EPIs ou locais.</p><p className="mt-1 text-xs text-slate-400">Digite ao menos dois caracteres para começar.</p></div>
              ) : !loading && resultCount === 0 ? (
                <div className="px-8 py-12 text-center text-slate-500"><p className="text-sm">Nenhum resultado para &quot;{query}&quot;.</p><p className="mt-1 text-xs text-slate-400">Confira o nome ou tente outra palavra.</p></div>
              ) : (
                <div className="space-y-2">
                  {results.employees.length > 0 && (
                    <section className="p-2" aria-labelledby={`${resultsId}-employees`}>
                      <h3 id={`${resultsId}-employees`} className="text-xs font-black text-slate-500 uppercase tracking-widest px-3 mb-2">Colaboradores</h3>
                      {results.employees.map((employee) => (
                        <button type="button" tabIndex={-1} data-search-result key={employee.id} onClick={() => navigateTo(`/employees?search=${encodeURIComponent(employee.full_name)}`)} className="w-full p-4 hover:bg-slate-50 rounded-2xl flex items-center gap-4 transition-colors group">
                          <span className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center"><User className="w-5 h-5 text-[#2563EB]" /></span>
                          <span className="flex-1 text-left"><span className="block text-sm font-bold text-slate-800 uppercase tracking-tight">{employee.full_name}</span><span className="block text-xs text-slate-500 font-medium">CPF: {employee.cpf}</span></span>
                          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#2563EB]" />
                        </button>
                      ))}
                    </section>
                  )}

                  {results.ppes.length > 0 && (
                    <section className="p-2 border-t border-slate-100" aria-labelledby={`${resultsId}-ppes`}>
                      <h3 id={`${resultsId}-ppes`} className="text-xs font-black text-slate-500 uppercase tracking-widest px-3 mb-2 mt-2">Equipamentos (EPIs)</h3>
                      {results.ppes.map((ppe) => (
                        <button type="button" tabIndex={-1} data-search-result key={ppe.id} onClick={() => navigateTo(`/ppes?search=${encodeURIComponent(ppe.name)}`)} className="w-full p-4 hover:bg-slate-50 rounded-2xl flex items-center gap-4 transition-colors group">
                          <span className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center"><Shield className="w-5 h-5 text-slate-600" /></span>
                          <span className="flex-1 text-left"><span className="block text-sm font-bold text-slate-800 uppercase tracking-tight">{ppe.name}</span><span className="block text-xs text-slate-500 font-medium">C.A: {ppe.ca_number}</span></span>
                          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#2563EB]" />
                        </button>
                      ))}
                    </section>
                  )}

                  {results.workplaces.length > 0 && (
                    <section className="p-2 border-t border-slate-100" aria-labelledby={`${resultsId}-workplaces`}>
                      <h3 id={`${resultsId}-workplaces`} className="text-xs font-black text-slate-500 uppercase tracking-widest px-3 mb-2 mt-2">Obras e Canteiros</h3>
                      {results.workplaces.map((workplace) => (
                        <button type="button" tabIndex={-1} data-search-result key={workplace.id} onClick={() => navigateTo(`/workplaces?search=${encodeURIComponent(workplace.name)}`)} className="w-full p-4 hover:bg-slate-50 rounded-2xl flex items-center gap-4 transition-colors group">
                          <span className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center"><HardDrive className="w-5 h-5 text-slate-600" /></span>
                          <span className="flex-1 text-left"><span className="block text-sm font-bold text-slate-800 uppercase tracking-tight">{workplace.name}</span></span>
                          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#2563EB]" />
                        </button>
                      ))}
                    </section>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] bg-slate-50 border-t border-slate-100 flex justify-between items-center gap-3 text-xs font-black text-slate-500 uppercase tracking-wide">
              <span className="hidden sm:inline">Use as setas para navegar</span>
              <span>Pressione <kbd className="bg-white px-1 py-0.5 rounded border border-slate-200">ESC</kbd> para fechar</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
