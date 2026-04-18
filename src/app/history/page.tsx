"use client"

import { useState, useEffect } from "react"
import { History, Download, ShieldCheck, Search, Loader2, ExternalLink } from "lucide-react"
import { api } from "@/services/api"

export default function HistoryPage() {
  const [records, setRecords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    async function fetchHistory() {
      try {
        setLoading(true)
        const data = await api.getDeliveries()
        setRecords(data)
      } catch (err) {
        console.error("Erro histórico:", err)
      } finally {
        setLoading(false)
      }
    }
    fetchHistory()
  }, [])

  const filteredRecords = records.filter(rec => 
    rec.employee?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    rec.id.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-800 flex items-center uppercase tracking-tighter">
            <History className="w-6 h-6 mr-2 text-[#8B1A1A]" />
            Auditoria Antares • Live
          </h1>
          <p className="text-slate-500 text-sm mt-1">Consulta direta ao banco de dados Supabase para conformidade NR-06.</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-200 bg-slate-50/50">
          <div className="relative max-w-md">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar colaborador ou ID da entrega..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-200 text-slate-900 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[#8B1A1A] transition-all"
            />
          </div>
        </div>
        
        <div className="overflow-x-auto min-h-[300px] flex flex-col">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-[#8B1A1A] mb-2" />
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Acessando Arquivo Digital...</p>
             </div>
          ) : (
            <table className="w-full text-sm text-left">
                <thead className="text-[10px] text-slate-400 bg-white uppercase tracking-[0.2em] border-b border-slate-100 font-black">
                <tr>
                    <th className="px-6 py-5">Protocolo</th>
                    <th className="px-6 py-5">Colaborador</th>
                    <th className="px-6 py-5">EPI / CA</th>
                    <th className="px-6 py-5">Data da Entrega</th>
                    <th className="px-6 py-5">Assinatura Digital</th>
                    <th className="px-6 py-5 text-right">Ação</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                {filteredRecords.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-5 font-mono text-[10px] text-slate-400">#{rec.id.slice(0, 8)}</td>
                    <td className="px-6 py-5 font-bold text-slate-800">{rec.employee?.full_name}</td>
                    <td className="px-6 py-5 text-slate-600 font-medium">
                        {rec.ppe?.name} <br/>
                        <span className="text-[10px] text-slate-400 font-bold uppercase">CA {rec.ppe?.ca_number}</span>
                    </td>
                    <td className="px-6 py-5 text-slate-400 text-xs font-bold uppercase">
                        {new Date(rec.delivery_date).toLocaleDateString()} <br/>
                        {new Date(rec.delivery_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-6 py-5">
                        {rec.signature_url ? (
                             <a 
                                href={rec.signature_url} 
                                target="_blank" 
                                className="flex items-center text-[10px] text-green-600 font-bold bg-green-50 px-2 py-1 rounded border border-green-100 hover:bg-green-100 transition-colors w-fit"
                             >
                                <ShieldCheck className="w-3 h-3 mr-1" />
                                Validada
                             </a>
                        ) : (
                            <span className="text-[10px] text-amber-500 font-bold bg-amber-50 px-2 py-1 rounded border border-amber-100 w-fit">Pendente</span>
                        )}
                    </td>
                    <td className="px-6 py-5 text-right">
                        <button className="text-[#8B1A1A] hover:bg-red-50 font-black text-[10px] uppercase tracking-widest flex items-center justify-end w-full p-2 rounded transition-all group-hover:underline">
                            <Download className="w-4 h-4 mr-1" />
                            PDF
                        </button>
                    </td>
                    </tr>
                ))}
                {filteredRecords.length === 0 && (
                    <tr>
                        <td colSpan={6} className="px-6 py-20 text-center text-slate-400 italic font-medium">
                            Nenhum registro de entrega encontrado no histórico.
                        </td>
                    </tr>
                )}
                </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
