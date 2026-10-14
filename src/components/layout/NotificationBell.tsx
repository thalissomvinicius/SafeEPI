"use client"

import { useCallback, useEffect, useId, useState } from "react"
import { Bell, CheckCircle2, Calendar, Package, Loader2, RefreshCw } from "lucide-react"
import { api, type SystemNotification } from "@/services/api"
import { useDialogAccessibility } from "@/hooks/useDialogAccessibility"

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<SystemNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const titleId = useId()
  const panelId = useId()
  const closePanel = useCallback(() => setIsOpen(false), [])
  const panelRef = useDialogAccessibility<HTMLDivElement>(isOpen, closePanel)

  const checkNotifications = useCallback(async () => {
      try {
        setLoading(true)
        setLoadError(false)
        setNotifications(await api.getNotifications())
      } catch (error) {
        setLoadError(true)
        console.error("Erro ao carregar notificações:", error)
      } finally {
        setLoading(false)
      }
  }, [])

  useEffect(() => {
    const initialCheck = window.setTimeout(() => void checkNotifications(), 0)
    // Refresh notifications every 10 minutes
    const interval = setInterval(checkNotifications, 10 * 60 * 1000)
    return () => {
      window.clearTimeout(initialCheck)
      clearInterval(interval)
    }
  }, [checkNotifications])

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="group relative flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-50"
        title="Notificações"
        type="button"
        aria-label={`Alertas: ${notifications.length} pendente(s)`}
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        <Bell className="w-5 h-5 text-slate-600 group-hover:text-[#2563EB] transition-colors" />
        {notifications.length > 0 && (
          <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-[#2563EB]"></span>
        )}
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-[60]" 
            onClick={() => setIsOpen(false)}
          ></div>
            <div
              id={panelId}
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              className="safeepi-panel-enter fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[70] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_48px_rgb(15_23_42/14%)] md:absolute md:left-auto md:right-0 md:top-auto md:mt-3 md:w-96"
            >
            <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 id={titleId} className="font-semibold tracking-tight text-slate-800">Central de alertas</h2>
              <span className="rounded-full bg-[var(--brand-tint)] px-2 py-0.5 text-xs font-semibold text-[#2563EB]">{notifications.length}</span>
            </div>

            <div className="max-h-[60dvh] md:max-h-[400px] overflow-y-auto">
              {loading ? (
                <div className="p-10 flex flex-col items-center justify-center text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                  <p className="text-xs">Atualizando alertas…</p>
                </div>
              ) : loadError ? (
                <div className="space-y-3 px-6 py-8 text-center" role="status">
                  <p className="text-sm text-slate-600">Não foi possível atualizar os alertas.</p>
                  <button type="button" onClick={() => void checkNotifications()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className="h-4 w-4" />Tentar novamente</button>
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
                        <RefreshCw className="w-5 h-5 text-red-600" />
                      )}
                    </div>
                    <div>
                      <h4 className={`text-sm font-semibold tracking-tight ${
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
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800">Nenhum alerta no momento</p>
                  <p className="mt-1 text-xs text-slate-400">Estoque e vencimentos são verificados periodicamente.</p>
                </div>
              )}
            </div>
            
            <button 
              onClick={closePanel}
              className="min-h-11 w-full border-t border-slate-100 py-3 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50"
              type="button"
            >
              Fechar painel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
