type FetchImageDataUrlOptions = {
  required?: boolean
  label?: string
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("Nao foi possivel converter a imagem."))
    reader.readAsDataURL(blob)
  })
}

export async function fetchImageDataUrl(
  url?: string | null,
  options: FetchImageDataUrlOptions = {},
): Promise<string | null> {
  if (!url) return null
  if (url.startsWith("data:image/")) return url

  const label = options.label || "imagem"

  try {
    const response = await fetch(url, { cache: "no-store" })
    if (!response.ok) {
      throw new Error(`Nao foi possivel carregar ${label} (HTTP ${response.status}).`)
    }

    const blob = await response.blob()
    if (!blob.type.startsWith("image/")) {
      throw new Error(`O arquivo de ${label} nao e uma imagem valida.`)
    }

    const dataUrl = await readBlobAsDataUrl(blob)
    if (!dataUrl.startsWith("data:image/")) {
      throw new Error(`O arquivo de ${label} nao pode ser convertido.`)
    }

    return dataUrl
  } catch (error) {
    if (options.required) {
      throw error instanceof Error ? error : new Error(`Nao foi possivel carregar ${label}.`)
    }
    return null
  }
}
