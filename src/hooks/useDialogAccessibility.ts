"use client"

import { useEffect, useRef, type RefObject } from "react"

const FOCUSABLE_SELECTOR = [
  "button:not([disabled]):not([tabindex='-1'])",
  "a[href]:not([tabindex='-1'])",
  "input:not([disabled]):not([tabindex='-1'])",
  "select:not([disabled]):not([tabindex='-1'])",
  "textarea:not([disabled]):not([tabindex='-1'])",
  "summary:not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

const openDialogs: HTMLElement[] = []
let bodyOverflowBeforeDialogs = ""

function visibleFocusable(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => {
    if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false
    for (let node: HTMLElement | null = element; node && node !== dialog; node = node.parentElement) {
      const style = window.getComputedStyle(node)
      if (style.display === "none" || style.visibility === "hidden") return false
      if (node instanceof HTMLDetailsElement && !node.open) {
        const summary = node.querySelector("summary")
        if (!summary?.contains(element)) return false
      }
    }
    return true
  })
}

export function useDialogAccessibility<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
): RefObject<T | null> {
  const dialogRef = useRef<T | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const dialog = dialogRef.current
    if (!dialog) return
    if (openDialogs.length === 0) bodyOverflowBeforeDialogs = document.body.style.overflow
    document.body.style.overflow = "hidden"

    if (dialog) {
      // Mount effects run from children to parents. Insert an enclosing dialog
      // before its child so Escape/Tab always belong to the topmost layer.
      const childIndex = openDialogs.findIndex(other => dialog.contains(other))
      if (childIndex < 0) openDialogs.push(dialog)
      else openDialogs.splice(childIndex, 0, dialog)
    }

    // Opening a mobile dialog must not summon the keyboard automatically.
    // A parent's mount effect also must not steal focus from its child dialog.
    if (openDialogs.at(-1) === dialog) {
      const firstButton = visibleFocusable(dialog).find(element => element.tagName === "BUTTON")
      ;(firstButton || dialog).focus()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!dialog || openDialogs.at(-1) !== dialog || dialog.closest("[inert]")) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopImmediatePropagation()
        onCloseRef.current()
        return
      }

      if (event.key !== "Tab" || !dialogRef.current) return
      const focusable = visibleFocusable(dialogRef.current)

      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const focusOutside = !dialog.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || focusOutside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || focusOutside)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true)
      if (dialog) {
        const index = openDialogs.indexOf(dialog)
        if (index >= 0) openDialogs.splice(index, 1)
      }
      if (openDialogs.length === 0) document.body.style.overflow = bodyOverflowBeforeDialogs
      // Portal cleanup restores inert siblings after this hook's cleanup.
      queueMicrotask(() => {
        const target = returnFocusRef.current
        if (target?.isConnected && target !== document.body && target !== document.documentElement && !target.closest("[inert]")) target.focus()
        else openDialogs.at(-1)?.focus()
      })
    }
  }, [open])

  return dialogRef
}
