"use client"

import type { HTMLAttributes, ReactNode } from "react"
import { useDialogAccessibility } from "@/hooks/useDialogAccessibility"

type AccessibleOverlayProps = Omit<HTMLAttributes<HTMLDivElement>, "role"> & {
  children: ReactNode
  label: string
  onClose: () => void
}

export function AccessibleOverlay({
  children,
  label,
  onClose,
  ...props
}: AccessibleOverlayProps) {
  const dialogRef = useDialogAccessibility<HTMLDivElement>(true, onClose)

  return (
    <div
      {...props}
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
    >
      {children}
    </div>
  )
}
