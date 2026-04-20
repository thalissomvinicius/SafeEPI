"use client"

import { useState, useEffect } from "react"
import { TrendingDown, Download, BarChart3 as BarChartIcon, PieChart as PieChartIcon, ShieldCheck, Loader2, HardDrive } from "lucide-react"
import { api } from "@/services/api"
import { startOfMonth, isAfter } from "date-fns"
import { useAuth } from "@/contexts/AuthContext"
import { useRouter } from "next/navigation"
import { Skeleton } from "@/components/ui/Skeleton"
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts"


export default function ReportsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState([
    { label: "Investimento EPIs (Mês)", value: "R$ 0,00", change: "Atualizando..." },
    { label: "Entregas Totais", value: "0", change: "Total" },
    { label: "EPIs em Alerta (C.A.)", value: "0", change: "Vencendo" },
    { label: "Treinamentos Registrados", value: "0", change: "NR-01/06" },
  ])
  const [investmentByWorkplace, setInvestmentByWorkplace] = useState<{name: string, value: number}[]>([])
  const [ppeUsageData, setPpeUsageData] = useState<{name: string, value: number}[]>([])
  
  const COLORS = ['#8B1A1A', '#1e293b', '#475569', '#64748b', '#94a3b8']

  useEffect(() => {
    if (!authLoading && user && user.role === 'ALMOXARIFE') {
      router.push('/')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    async function loadReports() {
      if (!user || user.role === 'ALMOXARIFE') return

      try {
        setLoading(true)
        const [ppeData, deliveryData, trainingData, wpData] = await Promise.all([
          api.getPpes(),
          api.getDeliveries(),
          api.getTrainings(),
          api.getWorkplaces()
        ])

        // 1. Cálculo de Investimento do Mês
        const monthStart = startOfMonth(new Date())
        const monthDeliveries = deliveryData.filter(d => isAfter(new Date(d.delivery_date), monthStart))
        const monthTotal = monthDeliveries.reduce((acc, d) => acc + (d.ppe?.cost || 0), 0)

        // 2. CAs Críticos (Vencendo nos próximos 90 dias)
        const now = new Date()
        const criticalCount = ppeData.filter(p => {
          const expiry = new Date(p.ca_expiry_date)
          const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          return diffDays < 90
        }).length

        // 3. Investimento por Canteiro (Todos os tempos)
        const wpStats = wpData.map(wp => {
            const total = deliveryData
                .filter(d => d.workplace_id === wp.id)
                .reduce((acc, d) => acc + (d.ppe?.cost || 0), 0)
            return { name: wp.name, value: total }
        }).sort((a, b) => b.value - a.value)

        setInvestmentByWorkplace(wpStats)

        // 4. Top 5 EPIs mais entregues
        const ppeCounts: {[key: string]: number} = {}
        deliveryData.forEach(d => {
            if (d.ppe) {
                ppeCounts[d.ppe.name] = (ppeCounts[d.ppe.name] || 0) + d.quantity
            }
        })
        const ppeStats = Object.entries(ppeCounts)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5)
        setPpeUsageData(ppeStats)

        setStats([
          { label: "Investimento EPIs (Mês)", value: `R$ ${monthTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, change: `${monthDeliveries.length} itens` },
          { label: "Entregas Totais", value: deliveryData.length.toString(), change: "Sincronizado" },
          { label: "EPIs em Alerta (C.A.)", value: criticalCount.toString(), change: "Atenção" },
          { label: "Treinamentos Registrados", value: trainingData.length.toString(), change: "NR-01/06" },
        ])
      } catch (err) {
        console.error("Erro ao gerar relatórios:", err)
      } finally {
        setLoading(false)
      }
    }

    const timer = setTimeout(() => {
        loadReports()
    }, 0)
    return () => clearTimeout(timer)
  }, [user])

  if (authLoading || (user && user.role === 'ALMOXARIFE')) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="w-10 h-10 animate-spin text-[#8B1A1A] mb-4" />
        <p className="font-bold text-slate-400 uppercase tracking-widest text-xs italic">Validando acesso...</p>
      </div>
    )
  }

  if (loading) {
    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in">
            <div className="flex justify-between border-b border-slate-100 pb-8">
                <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-10 w-64" />
                </div>
                <Skeleton className="h-12 w-40" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Skeleton className="h-[400px] w-full rounded-3xl" />
                <Skeleton className="h-[400px] w-full rounded-3xl" />
            </div>
        </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 overflow-hidden">
        <div>
            <div className="flex items-center gap-2 mb-1">
                <span className="bg-[#8B1A1A] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-widest uppercase italic">Analytics / Supabase</span>
            </div>
            <h1 className="text-2xl font-black tracking-tighter text-slate-800 flex items-center uppercase">
                <TrendingDown className="w-6 h-6 mr-2 text-[#8B1A1A]" />
                BI & Inteligência Antares
            </h1>
            <p className="text-slate-500 text-sm mt-1 font-medium italic">Extração de custos operacionais e conformidade normativa.</p>
        </div>
        <button 
          onClick={() => window.print()}
          className="bg-white border border-slate-200 text-slate-600 px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center shadow-sm"
        >
            <Download className="w-4 h-4 mr-2 text-[#8B1A1A]" />
            Exportar PDF
        </button>
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

      {/* Seção de Gráficos Analíticos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Gráfico 1: Investimento por Canteiro */}
          <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
              <div className="flex items-center justify-between mb-8">
                  <div>
                      <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg">Investimento por Canteiro</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Distribuição total de custos (R$)</p>
                  </div>
                  <PieChartIcon className="w-5 h-5 text-[#8B1A1A]" />
              </div>
              
              <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                          <Pie
                              data={investmentByWorkplace}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={5}
                              dataKey="value"
                              animationDuration={1500}
                          >
                              {investmentByWorkplace.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                          </Pie>
                          <Tooltip 
                            formatter={(value: number) => `R$ ${value.toLocaleString('pt-BR')}`}
                            contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                          />
                          <Legend verticalAlign="bottom" height={36}/>
                      </PieChart>
                  </ResponsiveContainer>
              </div>
          </div>

          {/* Gráfico 2: Top 5 EPIs entregues */}
          <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
              <div className="flex items-center justify-between mb-8">
                  <div>
                      <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg">Top 5 Consumo de EPIs</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Itens mais retirados pela equipe</p>
                  </div>
                  <BarChartIcon className="w-5 h-5 text-[#8B1A1A]" />
              </div>
              
              <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ppeUsageData} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                          <XAxis type="number" hide />
                          <YAxis 
                            dataKey="name" 
                            type="category" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fill: '#64748b', fontSize: 10, fontWeight: 700}}
                            width={100}
                          />
                          <Tooltip 
                             cursor={{fill: '#f8fafc'}}
                             contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                          />
                          <Bar 
                            dataKey="value" 
                            fill="#8B1A1A" 
                            radius={[0, 10, 10, 0]} 
                            barSize={20}
                            animationDuration={2000}
                          />
                      </BarChart>
                  </ResponsiveContainer>
              </div>
          </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
          <div className="flex items-center justify-between mb-8">
              <div>
                  <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg">Ranking de Investimento</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Valores totais por canteiro de obra</p>
              </div>
              <TrendingDown className="w-5 h-5 text-[#8B1A1A]" />
          </div>
          
          <div className="space-y-6 flex-1 overflow-y-auto pr-2">
            {investmentByWorkplace.map((wp, i) => (
                <div key={i} className="space-y-2">
                    <div className="flex justify-between items-end">
                        <span className="text-sm font-bold text-slate-600 uppercase tracking-tighter">{wp.name}</span>
                        <span className="text-xs font-black text-[#8B1A1A]">R$ {wp.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-[#8B1A1A] transition-all duration-1000" 
                            ref={(el) => {
                                if (el) {
                                    el.style.width = `${Math.min(100, (wp.value / (investmentByWorkplace[0]?.value || 1)) * 100)}%`
                                }
                            }}
                        ></div>
                    </div>
                </div>
            ))}
            {investmentByWorkplace.length === 0 && (
                <p className="text-slate-400 text-sm italic text-center py-10">Nenhum canteiro com movimentações ainda.</p>
            )}
          </div>
            O algoritmo Antares analisa o fluxo de justificativas (Perda, Dano, Validade) para identificar padrões de comportamento.
          </p>
          <div className="mt-8 relative w-24 h-24">
             <div className="absolute inset-0 rounded-full border-[10px] border-slate-50 border-t-[#8B1A1A]/20 border-r-[#8B1A1A]/40 animate-[spin_3s_linear_infinite] transition-all"></div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl shadow-slate-900/40 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#8B1A1A]/10 rounded-full -mr-20 -mt-20 blur-3xl"></div>
        <div className="flex items-center gap-4 relative z-10 w-full sm:w-auto">
            <div className="bg-[#8B1A1A] p-4 rounded-xl shadow-lg shadow-red-900/50">
                <ShieldCheck className="w-8 h-8 text-white" />
            </div>
            <div>
                <h2 className="text-xl font-black uppercase tracking-tighter">Exportação Gerencial</h2>
                <p className="text-slate-400 text-sm font-medium">Arquivos validados para compliance NR-06.</p>
            </div>
        </div>
        <div className="flex gap-4 w-full sm:w-auto relative z-10">
            <button className="flex-1 sm:flex-none border border-slate-700 bg-slate-800 text-white px-8 py-4 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-700 transition-all flex items-center justify-center">
                <HardDrive className="w-4 h-4 mr-2" />
                Por Unidade
            </button>
            <button 
                onClick={() => window.print()}
                className="flex-1 sm:flex-none bg-white text-slate-900 px-8 py-4 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-slate-50 transition-all flex items-center justify-center border-b-4 border-slate-200"
            >
                <Download className="w-4 h-4 mr-2 text-[#8B1A1A]" />
                Consolidado
            </button>
        </div>
      </div>
    </div>
  )
}
