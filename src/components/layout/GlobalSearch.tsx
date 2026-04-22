"use client"

import { useState, useEffect, useRef } from "react"
import { Search, User, Shield, HardDrive, X, Loader2, ArrowRight } from "lucide-react"
import { api } from "@/services/api"
import { Employee, PPE, Workplace } from "@/types/database"
import { useRouter } from "next/navigation"

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<{
    employees: Employee[];
    ppes: PPE[];
    workplaces: Workplace[];
  }>({ employees: [], ppes: [], workplaces: [] })
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  // Atalho de teclado Ctrl+K ou Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(true)
      }
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (isOpen) {
        setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  useEffect(() => {
    const search = async () => {
      if (query.length < 2) {
        setResults({ employees: [], ppes: [], workplaces: [] })
        return
      }

      setLoading(true)
      try {
        const [emp, ppe, wp] = await Promise.all([
          api.getEmployees(),
          api.getPpes(),
          api.getWorkplaces()
        ])

        const filteredEmp = emp.filter(e => e.full_name.toLowerCase().includes(query.toLowerCase())).slice(0, 3)
        const filteredPpe = ppe.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 3)
        const filteredWp = wp.filter(w => w.name.toLowerCase().includes(query.toLowerCase())).slice(0, 3)

        setResults({
          employees: filteredEmp,
          ppes: filteredPpe,
          workplaces: filteredWp
        })
      } catch (error) {
        console.error("Erro na busca global:", error)
      } finally {
        setLoading(false)
      }
    }

    const timer = setTimeout(search, 300)
    return () => clearTimeout(timer)
  }, [query])

  const navigateTo = (path: string) => {
    setIsOpen(false)
    setQuery("")
    router.push(path)
  }

  return (
    <>
      {/* Mobile Search Icon */}
      <button 
        onClick={() => setIsOpen(true)}
        className="md:hidden p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-[#8B1A1A] transition-all"
        title="Buscar"
      >
        <Search className="w-5 h-5" />
      </button>

      {/* Desktop Search Bar */}
      <button 
        onClick={() => setIsOpen(true)}
        className="hidden md:flex items-center gap-3 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:border-[#8B1A1A]/30 hover:bg-white transition-all w-64 group"
      >
        <Search className="w-4 h-4 group-hover:text-[#8B1A1A] transition-colors" />
        <span className="text-xs font-bold uppercase tracking-widest flex-1 text-left">Busca Global...</span>
        <kbd className="text-[10px] bg-white border border-slate-200 px-1.5 py-0.5 rounded-md font-sans">Ctrl+K</kbd>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setIsOpen(false)}></div>
          
        <div className="bg-white w-full max-w-2xl md:rounded-3xl shadow-2xl z-[110] overflow-hidden animate-in zoom-in-95 md:slide-in-from-top-10 duration-300 flex flex-col border border-slate-100 h-full md:h-auto">
          <div className="p-4 md:p-6 border-b border-slate-100 flex items-center gap-2 md:gap-4">
            <Search className="w-5 h-5 md:w-6 md:h-6 text-[#8B1A1A]" />
            <input 
              ref={inputRef}
              type="text" 
              placeholder="Buscar..."
              className="flex-1 bg-transparent border-none outline-none text-base md:text-lg font-bold text-slate-800 placeholder:text-slate-300"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
              ) : (
                <button onClick={() => setIsOpen(false)} title="Fechar busca" className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              )}
            </div>

            <div className="max-h-[500px] overflow-y-auto p-2">
              {query.length < 2 ? (
                <div className="p-12 text-center text-slate-400">
                  <p className="text-sm font-bold uppercase tracking-widest italic">Digite para começar a buscar...</p>
                </div>
              ) : (results.employees.length === 0 && results.ppes.length === 0 && results.workplaces.length === 0) ? (
                <div className="p-12 text-center text-slate-400">
                  <p className="text-sm font-bold uppercase tracking-widest italic">Nenhum resultado encontrado para "{query}"</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {results.employees.length > 0 && (
                    <div className="p-2">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 mb-2">Colaboradores</h4>
                      {results.employees.map(e => (
                        <button 
                          key={e.id}
                          onClick={() => navigateTo(`/employees`)}
                          className="w-full p-4 hover:bg-slate-50 rounded-2xl flex items-center gap-4 transition-colors group"
                        >
                          <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                            <User className="w-5 h-5 text-[#8B1A1A]" />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="text-sm font-bold text-slate-800 uppercase tracking-tight">{e.full_name}</p>
                            <p className="text-[10px] text-slate-400 font-medium">CPF: {e.cpf}</p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-200 group-hover:text-[#8B1A1A] group-hover:translate-x-1 transition-all" />
                        </button>
                      ))}
                    </div>
                  )}

                  {results.ppes.length > 0 && (
                    <div className="p-2 border-t border-slate-50">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 mb-2 mt-2">Equipamentos (EPIs)</h4>
                      {results.ppes.map(p => (
                        <button 
                          key={p.id}
                          onClick={() => navigateTo(`/ppes`)}
                          className="w-full p-4 hover:bg-slate-50 rounded-2xl flex items-center gap-4 transition-colors group"
                        >
                          <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                            <Shield className="w-5 h-5 text-slate-600" />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="text-sm font-bold text-slate-800 uppercase tracking-tight">{p.name}</p>
                            <p className="text-[10px] text-slate-400 font-medium">C.A: {p.ca_number}</p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-200 group-hover:text-[#8B1A1A] group-hover:translate-x-1 transition-all" />
                        </button>
                      ))}
                    </div>
                  )}

                  {results.workplaces.length > 0 && (
                    <div className="p-2 border-t border-slate-50">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 mb-2 mt-2">Canteiros de Obra</h4>
                      {results.workplaces.map(w => (
                        <button 
                          key={w.id}
                          onClick={() => navigateTo(`/workplaces`)}
                          className="w-full p-4 hover:bg-slate-50 rounded-2xl flex items-center gap-4 transition-colors group"
                        >
                          <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                            <HardDrive className="w-5 h-5 text-slate-600" />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="text-sm font-bold text-slate-800 uppercase tracking-tight">{w.name}</p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-200 group-hover:text-[#8B1A1A] group-hover:translate-x-1 transition-all" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <span>Dica: Use as setas para navegar</span>
              <span>Pressione <kbd className="bg-white px-1 py-0.5 rounded border border-slate-200 text-slate-500">ESC</kbd> para fechar</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
