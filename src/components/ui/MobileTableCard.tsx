// responsive: revisado — mobile-first ✓
"use client"

import { ReactNode, useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

type MobileTableCardBadge = {
  label: string
  variant: string
}

type MobileTableCardField = {
  label: string
  value: string | ReactNode
}

type MobileTableCardProps = {
  title: string
  subtitle?: string
  badge?: MobileTableCardBadge
  fields: MobileTableCardField[]
  actions?: ReactNode
  expandable?: boolean
  leading?: ReactNode
}

export function MobileTableCard({
  title,
  subtitle,
  badge,
  fields,
  actions,
  expandable = false,
  leading,
}: MobileTableCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const visibleFields = expandable ? fields.slice(0, 2) : fields
  const hiddenFields = expandable ? fields.slice(2) : []

  return (
    <article className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/80 md:hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {leading && <div className="shrink-0">{leading}</div>}
          <div className="min-w-0">
            <h3 className="break-words text-sm font-medium leading-snug text-slate-900">{title}</h3>
            {subtitle && <p className="mt-1 break-words text-xs font-bold text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {badge && (
          <span className={cn("max-w-[42%] shrink-0 truncate rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest", badge.variant)}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {visibleFields.map((field) => (
          <div key={field.label} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{field.label}</p>
            <div className="mt-1 break-words text-xs font-bold leading-snug text-slate-700">{field.value}</div>
          </div>
        ))}
      </div>

      {hiddenFields.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black uppercase tracking-widest text-slate-500 transition-all hover:bg-slate-50"
            aria-expanded={isExpanded}
          >
            {isExpanded ? "Ver menos" : "Ver mais"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
          </button>
          {isExpanded && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {hiddenFields.map((field) => (
                <div key={field.label} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{field.label}</p>
                  <div className="mt-1 break-words text-xs font-bold leading-snug text-slate-700">{field.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {actions && <div className="mt-4 w-full max-w-full overflow-hidden border-t border-slate-100 pt-3">{actions}</div>}
    </article>
  )
}
