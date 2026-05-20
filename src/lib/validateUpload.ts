import { NextResponse } from "next/server"

type UploadKind = "image" | "pdf" | "image-or-pdf"

const IMAGE_MAX_SIZE = 10 * 1024 * 1024
const PDF_MAX_SIZE = 20 * 1024 * 1024
const EXECUTABLE_EXTENSIONS = new Set(["exe", "sh", "js", "php", "py", "bat"])

export type ValidatedUpload = {
  buffer: ArrayBuffer
  contentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"
  extension: "jpg" | "png" | "webp" | "pdf"
}

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() || ""
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((byte, index) => bytes[index] === byte)
}

function detectFile(bytes: Uint8Array): Omit<ValidatedUpload, "buffer"> | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { contentType: "image/jpeg", extension: "jpg" }
  }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return { contentType: "image/png", extension: "png" }
  }

  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { contentType: "image/webp", extension: "webp" }
  }

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return { contentType: "application/pdf", extension: "pdf" }
  }

  return null
}

function isAllowed(kind: UploadKind, extension: ValidatedUpload["extension"]) {
  if (kind === "image") return extension !== "pdf"
  if (kind === "pdf") return extension === "pdf"
  return true
}

export async function validateUpload(file: File, kind: UploadKind): Promise<ValidatedUpload> {
  const extension = getExtension(file.name || "")
  if (extension && EXECUTABLE_EXTENSIONS.has(extension)) {
    throw NextResponse.json({ error: "Tipo de arquivo nao permitido." }, { status: 400 })
  }

  if (file.size <= 0) {
    throw NextResponse.json({ error: "Arquivo vazio ou invalido." }, { status: 400 })
  }

  const maxSize = kind === "pdf" ? PDF_MAX_SIZE : kind === "image" ? IMAGE_MAX_SIZE : PDF_MAX_SIZE
  if (file.size > maxSize) {
    throw NextResponse.json({ error: `Arquivo excede o limite de ${Math.floor(maxSize / 1024 / 1024)}MB.` }, { status: 413 })
  }

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer.slice(0, 16))
  const detected = detectFile(bytes)

  if (!detected || !isAllowed(kind, detected.extension)) {
    throw NextResponse.json({ error: "Formato real do arquivo nao permitido." }, { status: 400 })
  }

  const detectedMaxSize = detected.extension === "pdf" ? PDF_MAX_SIZE : IMAGE_MAX_SIZE
  if (file.size > detectedMaxSize) {
    throw NextResponse.json({ error: `Arquivo excede o limite de ${Math.floor(detectedMaxSize / 1024 / 1024)}MB.` }, { status: 413 })
  }

  return { buffer, ...detected }
}

export function validateUploadBuffer(buffer: Buffer, kind: UploadKind): Omit<ValidatedUpload, "buffer"> {
  const detected = detectFile(new Uint8Array(buffer.subarray(0, 16)))
  if (!detected || !isAllowed(kind, detected.extension)) {
    throw NextResponse.json({ error: "Formato real do arquivo nao permitido." }, { status: 400 })
  }

  const maxSize = detected.extension === "pdf" ? PDF_MAX_SIZE : IMAGE_MAX_SIZE
  if (buffer.byteLength > maxSize) {
    throw NextResponse.json({ error: `Arquivo excede o limite de ${Math.floor(maxSize / 1024 / 1024)}MB.` }, { status: 413 })
  }

  return detected
}
