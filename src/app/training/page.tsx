"use client"

import { CheckCircle2, Award, Calendar, Search } from "lucide-react"
import { MOCK_EMPLOYEES } from "@/lib/mockData"

export default function TrainingPage() {
  const trainingRecords = [
    { employeeId: "1", training: "Uso e Guarda de EPI (NR-06)", date: "10/01/2026", validUntil: "10/01/2027", status: "Válido" },
    { employeeId: "2", training: "Uso e Guarda de EPI (NR-06)", date: "15/02/2026", validUntil: "15/02/2027", status: "Válido" },
    { employeeId: "3", training: "Uso e Guarda de EPI (NR-06)", date: "20/05/2025", validUntil: "20/05/2026", status: "Vencendo" },
  ]

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center uppercase tracking-tighter">
            <Award className="w-6 h-6 mr-2 text-[#8B1A1A]" />
            Certificações e Treinamentos Antares
        </h1>
        <p className="text-slate-500 text-sm mt-1">Gestão de competências e treinamentos obrigatórios conforme NR-01 e NR-06.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50">
          <div className="relative max-w-sm">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar treinamento ou colaborador..." 
              className="w-full bg-white border border-slate-300 text-slate-900 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-[#8B1A1A] focus:ring-1 focus:ring-[#8B1A1A]"
            />
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 bg-slate-50 uppercase border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-black uppercase tracking-widest">Colaborador</th>
                <th className="px-6 py-4 font-black uppercase tracking-widest">Treinamento</th>
                <th className="px-6 py-4 font-black uppercase tracking-widest">Realizado em</th>
                <th className="px-6 py-4 font-black uppercase tracking-widest">Válido até</th>
                <th className="px-6 py-4 font-black text-right uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trainingRecords.map((rec, i) => {
                  const emp = MOCK_EMPLOYEES.find(e => e.id === rec.employeeId)
                  return (
                    <tr key={i} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-800">{emp?.name}</td>
                      <td className="px-6 py-4 text-slate-600 font-medium">{rec.training}</td>
                      <td className="px-6 py-4 text-slate-400 flex items-center">
                        <Calendar className="w-3 h-3 mr-1" /> {rec.date}
                      </td>
                      <td className="px-6 py-4 text-slate-400">{rec.validUntil}</td>
                      <td className="px-6 py-4 text-right">
                        <span className={`px-3 py-1 text-[10px] font-black uppercase rounded-full border ${
                          rec.status === 'Válido' 
                            ? 'bg-green-50 text-green-700 border-green-200' 
                            : 'bg-amber-50 text-amber-700 border-amber-200 shadow-sm shadow-amber-900/10'
                        }`}>
                          {rec.status}
                        </span>
                      </td>
                    </tr>
                  )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center text-center">
        <CheckCircle2 className="w-12 h-12 text-slate-300 mb-4" />
        <h3 className="font-bold text-slate-800">Registrar Novo Treinamento</h3>
        <p className="text-sm text-slate-400 max-w-md mt-2">
          Gere atas de treinamento coletivas e vincule certificados individuais ao prontuário do colaborador Antares.
        </p>
        <button className="mt-6 bg-white border border-slate-200 hover:border-[#8B1A1A] text-[#8B1A1A] font-bold px-6 py-2 rounded-lg text-xs uppercase tracking-widest transition-all shadow-sm">
            Iniciar Registro NR-01
        </button>
      </div>
    </div>
  )
}
