"use client"

import { useState, useEffect } from "react"
import { Bell, AlertTriangle, Calendar, Package, X, Loader2 } from "lucide-react"
import { api } from "@/services/api"
import { PPE } from "@/types/database"

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<{
    id: string;
    title: string;
    description: string;
    type: 'CA' | 'STOCK';
    severity: 'high' | 'medium';
  }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkNotifications() {
      try {
        setLoading(true)
        const [ppeData] = await Promise.all([api.getPpes()])
        
        const alerts: any[] = []
        const now = new Date()

        ppeData.forEach(ppe => {
          // Check CA Expiry
          const expiry = new Date(ppe.ca_expiry_date)
          const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          
          if (diffDays < 30) {
            alerts.push({
              id: `ca-${ppe.id}`,
              title: "C.A. Vencendo",
              description: `${ppe.name} vence em ${diffDays} dias.`,
              type: 'CA',
              severity: diffDays < 10 ? 'high' : 'medium'
            })
          }

          // Check Stock (Simple logic: < 5 is low)
          if (ppe.stock_balance < 5) {
            alerts.push({
              id: `stock-${ppe.id}`,
              title: "Estoque Baixo",
              description: `${ppe.name} tem apenas ${ppe.stock_balance} unidades.`,
              type: 'STOCK',
              severity: ppe.stock_balance <= 1 ? 'high' : 'medium'
            })
          }
        })

        setNotifications(alerts)
      } catch (error) {
        console.error("Erro ao carregar notificações:", error)
      } finally {
        setLoading(false)
      }
    }

    checkNotifications()
    // Refresh notifications every 10 minutes
    const interval = setInterval(checkNotifications, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all relative group"
        title="Notificações"
      >
        <Bell className="w-5 h-5 text-slate-600 group-hover:text-[#8B1A1A] transition-colors" />
        {notifications.length > 0 && (
          <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-[#8B1A1A] border-2 border-white rounded-full animate-bounce"></span>
        )}
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-[60]" 
            onClick={() => setIsOpen(false)}
          ></div>
          <div className="absolute right-0 mt-3 w-80 md:w-96 bg-white border border-slate-200 rounded-3xl shadow-2xl z-[70] overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-black text-slate-800 uppercase tracking-tighter">Central de Alertas</h3>
              <span className="bg-[#8B1A1A] text-white text-[10px] font-black px-2 py-0.5 rounded-full">{notifications.length}</span>
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {loading ? (
                <div className="p-10 flex flex-col items-center justify-center text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">Sincronizando...</p>
                </div>
              ) : notifications.length > 0 ? (
                notifications.map((notif) => (
                  <div key={notif.id} className="p-5 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-4">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                      notif.severity === 'high' ? 'bg-red-50' : 'bg-amber-50'
                    }`}>
                      {notif.type === 'CA' ? (
                        <Calendar className={`w-5 h-5 ${notif.severity === 'high' ? 'text-red-600' : 'text-amber-600'}`} />
                      ) : (
                        <Package className={`w-5 h-5 ${notif.severity === 'high' ? 'text-red-600' : 'text-amber-600'}`} />
                      )}
                    </div>
                    <div>
                      <h4 className={`text-xs font-black uppercase tracking-tight ${
                        notif.severity === 'high' ? 'text-red-700' : 'text-slate-800'
                      }`}>
                        {notif.title}
                      </h4>
                      <p className="text-xs text-slate-500 font-medium mt-0.5 leading-relaxed">
                        {notif.description}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-8 h-8 text-green-500" />
                  </div>
                  <p className="text-sm font-bold text-slate-800 uppercase tracking-tighter">Nenhum alerta crítico</p>
                  <p className="text-xs text-slate-400 mt-1">Tudo em conformidade com o SESMT.</p>
                </div>
              )}
            </div>
            
            <button 
              onClick={() => setIsOpen(false)}
              className="w-full py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:bg-slate-50 transition-colors border-t border-slate-50"
            >
              Fechar Painel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
