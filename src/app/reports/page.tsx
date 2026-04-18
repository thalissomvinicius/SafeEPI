"use client"

import { useState, useEffect } from "react"
import { TrendingDown, Download, BarChart3, PieChart, ShieldCheck, Loader2 } from "lucide-react"
import { api } from "@/services/api"
import { format, startOfMonth, isAfter } from "date-fns"

export default function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState([
    { label: "Investimento EPIs (Mês)", value: "R$ 0,00", change: "Atualizando..." },
    { label: "Entregas Totais", value: "0", change: "Total" },
    { label: "EPIs em Alerta (C.A.)", value: "0", change: "Vencendo" },
    { label: "Treinamentos Ativos", value: "0", change: "Certificados" },
  ])

  useEffect(() => {
    async function loadReports() {
      try {
        setLoading(true)
        const [empData, ppeData, deliveryData, trainingData] = await Promise.all([
          api.getEmployees(),
          api.getPpes(),
          api.getDeliveries(),
          api.getTrainings()
        ])

        // 1. Cálculo de Investimento do Mês
        const monthStart = startOfMonth(new Date())
        const monthDeliveries = (deliveryData as any[]).filter(d => isAfter(new Date(d.delivery_date), monthStart))
        const monthTotal = monthDeliveries.reduce((acc, d) => acc + (d.ppe?.cost || 0), 0)

        // 2. CAs Críticos (Vencendo nos próximos 90 dias)
        const now = new Date()
        const criticalCount = ppeData.filter(p => {
          const expiry = new Date(p.ca_expiry_date)
          const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          return diffDays < 90
        }).length

        setStats([
          { label: "Investimento EPIs (Mês)", value: `R$ ${monthTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, change: `${monthDeliveries.length} itens` },
          { label: "Entregas Totais", value: deliveryData.length.toString(), change: "Sincronizado" },
          { label: "CAs em Críticos", value: criticalCount.toString(), change: "Atenção" },
          { label: "Treinamentos Registrados", value: trainingData.length.toString(), change: "NR-01/06" },
        ])
      } catch (err) {
        console.error("Erro ao gerar relatórios:", err)
      } finally {
        setLoading(false)
      }
    }
    loadReports()
  }, [])

  if (loading) {
    return (
        <div className="flex flex-col items-center justify-center py-40">
            <Loader2 className="w-10 h-10 animate-spin text-[#8B1A1A] mb-4" />
            <p className="font-bold text-slate-400 uppercase tracking-widest text-xs italic">Compilando Inteligência SESMT Antares...</p>
        </div>
    )
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in">
      <div>
        <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
            <TrendingDown className="w-6 h-6 mr-2 text-[#8B1A1A]" />
            BI & Inteligência Antares
        </h1>
        <p className="text-slate-500 text-sm mt-1">Análise de custos e conformidade extraída em tempo real do Supabase.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{stat.label}</p>
            <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-800 tracking-tighter">{stat.value}</span>
                <span className="text-[10px] font-bold text-[#8B1A1A] bg-red-50 px-2 py-0.5 rounded">
                    {stat.change}
                </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center min-h-[350px] group hover:border-[#8B1A1A]/30 transition-all">
          <BarChart3 className="w-16 h-16 text-slate-100 mb-6 group-hover:scale-110 transition-transform text-[#8B1A1A]/10" />
          <h3 className="font-black text-slate-800 uppercase tracking-tighter">Investimento por Canteiro</h3>
          <p className="text-xs text-slate-400 mt-2 text-center max-w-xs">
            Visualize onde estão concentrados os maiores custos de reposição de EPIs em suas obras.
          </p>
          <div className="mt-8 flex gap-2">
            <span className="w-2 h-12 bg-slate-100 rounded-full animate-pulse"></span>
            <span className="w-2 h-20 bg-[#8B1A1A]/20 rounded-full"></span>
            <span className="w-2 h-16 bg-slate-100 rounded-full"></span>
            <span className="w-2 h-24 bg-[#8B1A1A]/40 rounded-full"></span>
            <span className="w-2 h-14 bg-slate-100 rounded-full"></span>
          </div>
        </div>

        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center min-h-[350px] group hover:border-[#8B1A1A]/30 transition-all">
          <PieChart className="w-16 h-16 text-slate-100 mb-6 group-hover:scale-110 transition-transform text-[#8B1A1A]/10" />
          <h3 className="font-black text-slate-800 uppercase tracking-tighter">Distribuição de Motivos</h3>
          <p className="text-xs text-slate-400 mt-2 text-center max-w-xs">
            Identifique se a maior parte das trocas é por desgaste natural ou perda negligente.
          </p>
          <div className="mt-8 relative w-24 h-24">
             <div className="absolute inset-0 rounded-full border-[10px] border-slate-50 border-t-[#8B1A1A]/20 border-r-[#8B1A1A]/40"></div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl shadow-slate-900/40 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#8B1A1A]/10 rounded-full -mr-20 -mt-20 blur-3xl"></div>
        <div className="flex items-center gap-4 relative z-10">
            <div className="bg-[#8B1A1A] p-4 rounded-xl shadow-lg shadow-red-900/50">
                <ShieldCheck className="w-8 h-8 text-white" />
            </div>
            <div>
                <h2 className="text-xl font-black uppercase tracking-tighter">Relatório Consolidado Mensal</h2>
                <p className="text-slate-400 text-sm font-medium">Exportação de conformidade para auditorias do Ministério do Trabalho.</p>
            </div>
        </div>
        <button 
          onClick={() => window.print()}
          className="bg-white text-slate-900 px-8 py-4 rounded-xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-slate-50 transition-all flex items-center relative z-10 border-b-4 border-slate-200"
        >
            <Download className="w-4 h-4 mr-2 text-[#8B1A1A]" />
            Imprimir Balanço SESMT
        </button>
      </div>
    </div>
  )
}
