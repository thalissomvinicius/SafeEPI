"use client"

import { Check, Info, X } from "lucide-react"

type ToastIconProps = {
  type: "success" | "error" | "warning" | "info"
}

const iconClassName = "h-3.5 w-3.5 stroke-[3] text-white"

export function ToastIcon({ type }: ToastIconProps) {
  const icon = {
    success: <Check className={iconClassName} />,
    error: <X className={iconClassName} />,
    warning: <span className="text-[13px] font-black leading-none text-white">!</span>,
    info: <Info className={iconClassName} />,
  }[type]

  return <span className={`safeepi-toast-icon safeepi-toast-icon-${type}`}>{icon}</span>
}
