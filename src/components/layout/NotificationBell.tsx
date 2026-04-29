"use client"

import { useState, useEffect } from "react"
import { Bell, AlertTriangle, Calendar, Package, Loader2, RefreshCw } from "lucide-react"
import { addDays, isPast } from "date-fns"
import { api } from "@/services/api"

type NotificationItem = {
  id: string;
  title: string;
  description: string;
  type: 'CA' | 'STOCK' | 'LIFESPAN';
  severity: 'high' | 'medium';
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkNotifications() {
      try {
        setLoading(true)
        const [ppeData, deliveryData] = await Promise.all([
          api.getPpes(),
          api.getDeliveries()
        ])
        
        const alerts: NotificationItem[] = []
        const now = new Date()

        // Check PPE Lifespan Alerts (Items in use that need replacement)
        deliveryData.forEach(delivery => {
          if (!delivery.returned_at && delivery.ppe?.lifespan_days) {
            const deliveryDate = new Date(delivery.delivery_date)
            const expiryDate = addDays(deliveryDate, delivery.ppe.lifespan_days)
            
            if (isPast(expiryDate)) {
              alerts.push({
                id: `expiry-${delivery.id}`,
                title: "Troca Obrigatória",
                description: `${delivery.employee?.full_name} está com ${delivery.ppe.name} vencido pelo uso.`,
                type: 'LIFESPAN',
                severity: 'high'
              })
            }
          }
        })

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
          if (ppe.current_stock < 5) {
            alerts.push({
              id: `stock-${ppe.id}`,
              title: "Estoque Baixo",
              description: `${ppe.name} tem apenas ${ppe.current_stock} unidades.`,
              type: 'STOCK',
              severity: ppe.current_stock <= 1 ? 'high' : 'medium'
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
          <div className="fixed right-3 left-3 top-16 md:absolute md:left-auto md:right-0 md:top-auto md:mt-3 md:w-96 bg-white border border-slate-200 rounded-2xl md:rounded-3xl shadow-2xl z-[70] overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-black text-slate-800 uppercase tracking-tighter">Central de Alertas</h3>
              <span className="bg-[#8B1A1A] text-white text-[10px] font-black px-2 py-0.5 rounded-full">{notifications.length}</span>
            </div>

            <div className="max-h-[60dvh] md:max-h-[400px] overflow-y-auto">
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
                      ) : notif.type === 'STOCK' ? (
                        <Package className={`w-5 h-5 ${notif.severity === 'high' ? 'text-red-600' : 'text-amber-600'}`} />
                      ) : (
                        <RefreshCw className="w-5 h-5 text-red-600 animate-spin-slow" />
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
