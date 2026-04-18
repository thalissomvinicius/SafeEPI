"use client"

import { TrendingDown, Download, BarChart3, PieChart, Users, ShieldCheck } from "lucide-react"

export default function ReportsPage() {
  const stats = [
    { label: "Custo Total EPIs (Mês)", value: "R$ 15.420,00", change: "+12%" },
    { label: "Taxa de Substituição", value: "4.2%", change: "-0.5%" },
    { label: "EPIs em Uso", value: "842 un", change: "+50 un" },
    { label: "Conformidade NR-06", value: "98%", change: "+2%" },
  ]

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center">
            <TrendingDown className="w-6 h-6 mr-2 text-[#8B1A1A]" />
            Relatórios e Inteligência SESMT
        </h1>
        <p className="text-slate-500 text-sm mt-1">Análise de custos, durabilidade e conformidade da Antares Empreendimentos.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
            <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-800">{stat.value}</span>
                <span className={`text-[10px] font-bold ${stat.change.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                    {stat.change}
                </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center min-h-[300px]">
          <BarChart3 className="w-12 h-12 text-slate-200 mb-4" />
          <h3 className="font-bold text-slate-800">Consumo por Setor</h3>
          <p className="text-xs text-slate-400 mt-2 text-center">Gráfico de barras detalhando o investimento em EPIs por canteiro de obra.</p>
          <button className="mt-6 text-xs font-bold text-[#8B1A1A] hover:underline uppercase tracking-widest">Visualizar Dados</button>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center min-h-[300px]">
          <PieChart className="w-12 h-12 text-slate-200 mb-4" />
          <h3 className="font-bold text-slate-800">Durabilidade Média</h3>
          <p className="text-xs text-slate-400 mt-2 text-center">Análise de vida útil real vs. estimada dos equipamentos.</p>
          <button className="mt-6 text-xs font-bold text-[#8B1A1A] hover:underline uppercase tracking-widest">Explorar Insights</button>
        </div>
      </div>

      <div className="bg-[#8B1A1A] rounded-xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-lg shadow-red-900/10">
        <div className="flex items-center gap-4">
            <div className="bg-white/10 p-3 rounded-lg">
                <ShieldCheck className="w-8 h-8 text-white" />
            </div>
            <div>
                <h2 className="text-xl font-bold">Relatório Consolidado Mensal</h2>
                <p className="text-red-100 text-sm opacity-80">Exportação completa de todas as assinaturas e entregas do mês.</p>
            </div>
        </div>
        <button className="bg-white text-[#8B1A1A] px-8 py-3 rounded-lg font-bold shadow-xl hover:bg-slate-50 transition-all flex items-center">
            <Download className="w-5 h-5 mr-2" />
            Exportar CSV/PDF
        </button>
      </div>
    </div>
  )
}
