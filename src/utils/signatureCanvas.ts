import type SignatureCanvas from "react-signature-canvas"

export function getSignatureDataUrl(canvas: SignatureCanvas | null, type = "image/png") {
  if (!canvas || canvas.isEmpty()) return null

  try {
    const trimmed = canvas.getTrimmedCanvas()
    return trimmed.toDataURL(type)
  } catch (error) {
    console.warn("[signatureCanvas] getTrimmedCanvas failed, using raw canvas.", error)
    return canvas.toDataURL(type)
  }
}
