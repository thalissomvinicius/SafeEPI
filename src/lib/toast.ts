import { toast as sonnerToast } from "sonner"

type ToastSubtitle = string | undefined
type ToastOptions = Parameters<typeof sonnerToast.success>[1]
type ToastKind = "success" | "error" | "warning" | "info"

const DEFAULT_DETAILS: Record<ToastKind, string> = {
  success: "",
  error: "Tente novamente ou contate o suporte.",
  warning: "",
  info: "",
}

function splitMessage(message: string, subtitle?: ToastSubtitle) {
  if (subtitle !== undefined) return { title: message, description: subtitle || undefined }

  const colonIndex = message.indexOf(": ")
  if (colonIndex > 0 && colonIndex < 40) {
    return {
      title: message.slice(0, colonIndex),
      description: message.slice(colonIndex + 2),
    }
  }

  return { title: message, description: undefined }
}

function show(kind: ToastKind, title: string, subtitle?: ToastSubtitle, options?: ToastOptions) {
  const content = splitMessage(title, subtitle)
  const description = content.description || DEFAULT_DETAILS[kind] || undefined

  return sonnerToast[kind](content.title, {
    ...options,
    description,
  })
}

export const toast = {
  success: (title: string, subtitle?: ToastSubtitle, options?: ToastOptions) => show("success", title, subtitle, options),
  error: (title: string, subtitle?: ToastSubtitle, options?: ToastOptions) => show("error", title, subtitle, options),
  warning: (title: string, subtitle?: ToastSubtitle, options?: ToastOptions) => show("warning", title, subtitle, options),
  info: (title: string, subtitle?: ToastSubtitle, options?: ToastOptions) => show("info", title, subtitle, options),
  dismiss: sonnerToast.dismiss,
  loading: sonnerToast.loading,
  promise: sonnerToast.promise,
  custom: sonnerToast.custom,
}
