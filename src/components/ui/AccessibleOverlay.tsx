"use client"

import type { HTMLAttributes, ReactNode } from "react"
import { useDialogAccessibility } from "@/hooks/useDialogAccessibility"
import { useVisualViewport } from "@/hooks/useVisualViewport"

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
  const isFixed = props.className?.split(/\s+/).includes("fixed") ?? false
  useVisualViewport(dialogRef, isFixed)

  return (
    <div
      {...props}
      className={`${props.className || ""}${isFixed ? " safeepi-viewport-overlay safeepi-modal-overlay" : ""}`}
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
