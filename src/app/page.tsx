"use client"

import { useState, useEffect } from "react"
import { Users, AlertTriangle, PackageCheck, ArrowRight, ShieldCheck, Archive, Boxes } from "lucide-react"
import Link from "next/link"
import { api } from "@/services/api"
import { DeliveryWithRelations } from "@/types/database"
import { Skeleton } from "@/components/ui/Skeleton"
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts"

function DashboardSkeleton() {
  return (
    <div className="p-6 md:p-8 md:pt-10 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-100 pb-8 gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-12 w-40" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-10" />
            </div>
            <Skeleton className="h-8 w-16 mb-2" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 h-[400px]">
          <Skeleton className="h-full w-full rounded-2xl" />
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 space-y-4">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-full w-full rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState({
    deliveries: 0,
    employees: 0,
    criticalCAs: 0,
    lowStock: 0,
    signedDocuments: 0,
  })
  const [recentDeliveries, setRecentDeliveries] = useState<DeliveryWithRelations[]>([])
  const [chartData, setChartData] = useState<{name: string, value: number}[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDashboardData() {
      try {
        setLoading(true)
        const [empData, ppeData, deliveryData, documentData] = await Promise.all([
          api.getEmployees(),
          api.getPpes(),
          api.getDeliveries(),
          api.getSignedDocuments()
        ])

        const now = new Date()
        const criticalCount = ppeData.filter(p => {
          const expiry = new Date(p.ca_expiry_date)
          const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          return diffDays < 90
        }).length

        setStats({
          deliveries: deliveryData.length,
          employees: empData.filter(e => e.active).length,
          criticalCAs: criticalCount,
          lowStock: ppeData.filter(p => p.active && (p.current_stock || 0) <= 5).length,
          signedDocuments: documentData.length
        })

        // Chart Data (Last 7 Days)
        const last7Days = [...Array(7)].map((_, i) => {
          const date = new Date()
          date.setDate(date.getDate() - (6 - i))
          const dateStr = date.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' })
          const count = deliveryData.filter(d => 
            new Date(d.delivery_date).toDateString() === date.toDateString()
          ).length
          return { name: dateStr, value: count }
        })
        setChartData(last7Days)

        setRecentDeliveries(deliveryData.slice(0, 5))
      } catch (err) {
        console.error("Erro dashboard:", err)
      } finally {
        setLoading(false)
      }
    }
    loadDashboardData()
  }, [])

  if (loading) return <DashboardSkeleton />

  return (
    <div className="p-4 sm:p-6 md:p-8 md:pt-10 max-w-7xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-end border-b border-slate-100 pb-6 md:pb-8 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-[#2563EB] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-wide md:tracking-widest uppercase italic">SESMT Digital • Cloud</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tighter text-slate-800 leading-tight">Painel de Risco Operacional</h1>
          <p className="text-sm sm:text-base text-slate-500 font-medium mt-1">Cada entrega registrada. Cada risco sob controle.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/delivery" className="w-full md:w-auto bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center">
            Nova Entrega <ArrowRight className="w-4 h-4 ml-2" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {[
          { title: "Entregas Realizadas", value: stats.deliveries, subtitle: "Total no banco de dados", icon: PackageCheck, color: "text-[#2563EB]", bg: "bg-red-50" },
          { title: "Equipe Ativa", value: stats.employees, subtitle: "Colaboradores cadastrados", icon: Users, color: "text-slate-800", bg: "bg-slate-100" },
          { title: "Estoque Baixo", value: stats.lowStock, subtitle: "Itens com 5 ou menos", icon: Boxes, color: "text-blue-700", bg: "bg-blue-50" },
          { title: "PDFs Auditados", value: stats.signedDocuments, subtitle: "Arquivo juridico ativo", icon: Archive, color: "text-emerald-700", bg: "bg-emerald-50" },
          { title: "CAs em Alerta", value: stats.criticalCAs, subtitle: "Atenção necessária", icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
        ].map((item, idx) => {
          const Icon = item.icon
          return (
            <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <span className="text-slate-400 font-black text-[10px] uppercase tracking-widest">{item.title}</span>
                <div className={`p-2 rounded-lg ${item.bg}`}>
                  <Icon className={`w-5 h-5 ${item.color}`} />
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-3xl font-black text-slate-800 tracking-tighter">{item.value}</span>
                <span className="text-xs font-bold text-slate-500 mt-1">{item.subtitle}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 shadow-sm flex flex-col min-w-0">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg">Atividade de Entregas</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Ãšltimos 7 dias em tempo real</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-[#2563EB] rounded-full animate-pulse"></div>
                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Live Sync</span>
                </div>
            </div>
            
            <div className="h-[280px] min-h-[280px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                        <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#2563EB" stopOpacity={0.1}/>
                                <stop offset="95%" stopColor="#2563EB" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}}
                            dy={10}
                        />
                        <YAxis hide />
                        <Tooltip 
                            formatter={(value) => [value ?? 0, "Entregas"]}
                            contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 'bold'}}
                            cursor={{stroke: '#2563EB', strokeWidth: 2, strokeDasharray: '4 4'}}
                        />
                        <Area 
                            type="monotone" 
                            dataKey="value" 
                            stroke="#2563EB" 
                            strokeWidth={4} 
                            fillOpacity={1} 
                            fill="url(#colorValue)" 
                            animationDuration={2000}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm flex flex-col h-full overflow-hidden">
            <div className="p-5 sm:p-8 border-b border-slate-50 flex justify-between items-center">
                <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg">Histórico Local</h3>
                <ShieldCheck className="w-5 h-5 text-green-500" />
            </div>
            <div className="flex-1 overflow-y-auto">
                <div className="divide-y divide-slate-50">
                    {recentDeliveries.map((delivery) => (
                        <div key={delivery.id} className="p-6 hover:bg-slate-50 transition-colors">
                            <div className="flex justify-between items-start mb-1">
                                <p className="font-black text-slate-800 uppercase tracking-tight text-sm truncate max-w-[150px]">
                                    {delivery.employee?.full_name}
                                </p>
                                <span className="text-[9px] font-black text-slate-400">#{delivery.id.slice(0,4)}</span>
                            </div>
                            <p className="text-[10px] text-slate-500 font-medium">
                                {delivery.ppe?.name} • {new Date(delivery.delivery_date).toLocaleDateString()}
                            </p>
                            <div className="mt-3 flex items-center justify-between">
                                <span className="px-2 py-0.5 bg-green-50 text-green-700 text-[8px] font-black uppercase rounded tracking-widest border border-green-100">Assinado</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="p-6 bg-slate-50 mt-auto border-t border-slate-100">
                <Link href="/history" className="text-[10px] font-black text-[#2563EB] uppercase tracking-widest hover:underline flex items-center justify-center">
                    Ver auditoria completa <ArrowRight className="w-3 h-3 ml-1" />
                </Link>
            </div>
        </div>
      </div>
    </div>
  )
}
