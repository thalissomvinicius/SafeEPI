type FetchImageDataUrlOptions = {
  required?: boolean
  label?: string
}

const IMAGE_DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i

export function imageDataUrlToFile(dataUrl: string, baseName: string): File {
  const match = IMAGE_DATA_URL_PATTERN.exec(dataUrl.trim())
  if (!match) {
    throw new Error("A assinatura gerada é inválida. Limpe e assine novamente.")
  }

  let binary: string
  try {
    binary = atob(match[2].replace(/\s/g, ""))
  } catch {
    throw new Error("A assinatura gerada é inválida. Limpe e assine novamente.")
  }

  if (!binary.length) {
    throw new Error("A assinatura está vazia. Limpe e assine novamente.")
  }

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  const mimeType = match[1].toLowerCase()
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png"

  return new File([bytes], `${baseName}.${extension}`, { type: mimeType })
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
