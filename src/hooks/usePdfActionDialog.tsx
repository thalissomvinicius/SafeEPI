"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PdfActionDialog } from "@/components/ui/PdfActionDialog"

type PdfDialogOptions = {
  description?: string
  title?: string
}

type PdfDialogState = {
  description?: string
  fileName: string
  isOpen: boolean
  title: string
  url: string | null
}

const initialState: PdfDialogState = {
  description: undefined,
  fileName: "",
  isOpen: false,
  title: "Documento PDF",
  url: null,
}

export function usePdfActionDialog() {
  const [state, setState] = useState<PdfDialogState>(initialState)
  const activeUrlRef = useRef<string | null>(null)

  const revokeActiveUrl = useCallback(() => {
    if (activeUrlRef.current) {
      window.URL.revokeObjectURL(activeUrlRef.current)
      activeUrlRef.current = null
    }
  }, [])

  const closePdfDialog = useCallback(() => {
    setState((prev) => {
      if (prev.url) {
        window.setTimeout(() => {
          window.URL.revokeObjectURL(prev.url as string)
        }, 1000)
      }

      if (activeUrlRef.current === prev.url) {
        activeUrlRef.current = null
      }

      return initialState
    })
  }, [])

  const openPdfDialog = useCallback((blob: Blob, fileName: string, options?: PdfDialogOptions) => {
    revokeActiveUrl()

    const url = window.URL.createObjectURL(blob)
    activeUrlRef.current = url

    setState({
      description: options?.description,
      fileName,
      isOpen: true,
      title: options?.title || "Documento PDF",
      url,
    })
  }, [revokeActiveUrl])

  useEffect(() => {
    return () => {
      revokeActiveUrl()
    }
  }, [revokeActiveUrl])

  const pdfActionDialog = useMemo(() => {
    if (!state.isOpen || !state.url) return null

    return (
      <PdfActionDialog
        description={state.description}
        fileName={state.fileName}
        onClose={closePdfDialog}
        onDownload={closePdfDialog}
        onPreview={closePdfDialog}
        title={state.title}
        url={state.url}
      />
    )
  }, [closePdfDialog, state.description, state.fileName, state.isOpen, state.title, state.url])

  return {
    closePdfDialog,
    openPdfDialog,
    pdfActionDialog,
  }
}
