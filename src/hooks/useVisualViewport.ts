"use client"

import { useEffect, type RefObject } from "react"

/** Keep a fixed dialog inside the visible screen when the mobile keyboard opens. */
export function useVisualViewport<T extends HTMLElement>(ref: RefObject<T | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const element = ref.current
    if (!element) return
    const viewport = window.visualViewport
    const update = () => {
      // Pinch zoom must retain the browser's normal panning behavior.
      const useViewport = viewport && Math.abs(viewport.scale - 1) < 0.01
      element.style.setProperty("--safeepi-viewport-height", `${useViewport ? viewport.height : window.innerHeight}px`)
      element.style.setProperty("--safeepi-viewport-top", `${useViewport ? viewport.offsetTop : 0}px`)
    }
    update()
    viewport?.addEventListener("resize", update)
    viewport?.addEventListener("scroll", update)
    window.addEventListener("resize", update)
    return () => {
      viewport?.removeEventListener("resize", update)
      viewport?.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      element.style.removeProperty("--safeepi-viewport-height")
      element.style.removeProperty("--safeepi-viewport-top")
    }
  }, [enabled, ref])
}
