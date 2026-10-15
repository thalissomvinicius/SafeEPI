"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import styles from "./button-loading.module.css"

/** Decorative: the surrounding control or status must supply the accessible name. */
function LoadingIndicator({ className }: { className?: string }) {
  const indicatorRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const indicator = indicatorRef.current
    // Keep a static progress mark where visibility observation is unavailable.
    if (!indicator || typeof IntersectionObserver === "undefined") return

    let inView = false
    const updateAnimation = () => {
      indicator.dataset.animated = String(inView && !document.hidden)
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = Boolean(entry?.isIntersecting)
      updateAnimation()
    })
    observer.observe(indicator)
    document.addEventListener("visibilitychange", updateAnimation)
    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", updateAnimation)
    }
  }, [])

  return (
    <span ref={indicatorRef} aria-hidden="true" data-slot="loading-indicator" className={cn(styles.indicator, className)}>
      <svg viewBox="0 0 24 24" fill="none" focusable="false">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export { LoadingIndicator }
