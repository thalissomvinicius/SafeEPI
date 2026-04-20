"use client"

import { useState, useEffect } from "react"
import { Users, AlertTriangle, PackageCheck, ArrowRight, ShieldCheck, Loader2 } from "lucide-react"
import Link from "next/link"
import { api } from "@/services/api"
import { DeliveryWithRelations } from "@/types/database"

export default function Dashboard() {
  const [stats, setStats] = useState({
    deliveries: 0,
    employees: 0,
    criticalCAs: 0,
  })
  const [recentDeliveries, setRecentDeliveries] = useState<DeliveryWithRelations[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDashboardData() {
      try {
        setLoading(true)
        const [empData, ppeData, deliveryData] = await Promise.all([
          api.getEmployees(),
          api.getPpes(),
          api.getDeliveries()
        ])

        // Lógica simples de CAs vencendo (nos próximos 90 dias ou já vencidos)
        const now = new Date()
        const criticalCount = ppeData.filter(p => {
          const expiry = new Date(p.ca_expiry_date)
          const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          return diffDays < 90
        }).length

        setStats({
          deliveries: deliveryData.length,
          employees: empData.filter(e => e.active).length,
          criticalCAs: criticalCount
        })

        setRecentDeliveries(deliveryData.slice(0, 5))
      } catch (err) {
        console.error("Erro dashboard:", err)
      } finally {
        setLoading(false)
      }
    }
    loadDashboardData()
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="w-10 h-10 animate-spin text-[#8B1A1A] mb-4" />
        <p className="font-bold text-slate-400 uppercase tracking-widest text-xs italic">Acessando Banco de Dados Antares...</p>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 md:pt-10 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-100 pb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-[#8B1A1A] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-widest uppercase italic">SESMT Digital • Cloud</span>
          </div>
          <h1 className="text-4xl font-black tracking-tighter text-slate-800">Antares Dashboard</h1>
          <p className="text-slate-500 font-medium mt-1">Gestão de Segurança Sincronizada com Supabase.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/delivery" className="bg-[#8B1A1A] hover:bg-[#681313] text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg shadow-red-900/20 transition-all flex items-center">
            Nova Entrega <ArrowRight className="w-4 h-4 ml-2" />
          </Link>
        </div>
      </div>

      {/* Cards de Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { title: "Entregas Realizadas", value: stats.deliveries, subtitle: "Total no banco de dados", icon: PackageCheck, color: "text-[#8B1A1A]", bg: "bg-red-50" },
          { title: "Equipe Ativa", value: stats.employees, subtitle: "Colaboradores cadastrados", icon: Users, color: "text-slate-800", bg: "bg-slate-100" },
          { title: "CAs em Alerta", value: stats.criticalCAs, subtitle: "Atenção necessária", icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
        ].map((item, idx) => {
          const Icon = item.icon
          return (
            <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
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

      {/* Seção Inferior: Vencimentos e Fila de Assinaturas */}
      <div className="grid lg:grid-cols-1 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 overflow-hidden">
          <h2 className="text-lg font-black text-slate-800 mb-6 flex items-center uppercase tracking-tighter">
            <ShieldCheck className="w-5 h-5 text-green-600 mr-2" />
            Últimas Movimentações Sincronizadas
          </h2>
          <div className="space-y-3">
            {recentDeliveries.length > 0 ? recentDeliveries.map((delivery, i) => (
              <div key={i} className="flex justify-between items-center p-4 hover:bg-slate-50 rounded-xl border border-slate-100 transition-colors">
                <div>
                  <p className="text-sm font-black text-slate-700 uppercase tracking-tighter">
                    {delivery.employee?.full_name} 
                    <span className="ml-2 text-[8px] text-slate-300 font-normal">[{delivery.workplace?.name || "Sede"}]</span>
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold mt-1">
                    {delivery.ppe?.name} • {new Date(delivery.delivery_date).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {delivery.signature_url && (
                    <span className="px-2 py-0.5 bg-green-50 text-green-700 text-[8px] font-black rounded border border-green-100 uppercase uppercase">Assinado</span>
                  )}
                  <div className="px-3 py-1 bg-slate-50 text-slate-400 text-[10px] font-black rounded border border-slate-100 uppercase tracking-widest font-mono">
                    #{delivery.id.slice(0, 4)}
                  </div>
                </div>
              </div>
            )) : (
              <p className="text-slate-400 text-sm italic py-10 text-center">Nenhuma entrega registrada ainda no Supabase.</p>
            )}
          </div>
          <Link href="/history" className="mt-6 inline-block text-[10px] font-black text-[#8B1A1A] uppercase tracking-widest hover:underline">
            Ver auditoria completa →
          </Link>
        </div>
      </div>
    </div>
  )
}
