import "server-only"

import { createHash } from "node:crypto"

export const MAX_SIGNED_PDF_BYTES = 15 * 1024 * 1024

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])

export function assertPdfBytes(
  bytes: Uint8Array,
  maxBytes = MAX_SIGNED_PDF_BYTES,
): void {
  if (bytes.byteLength === 0) {
    throw new Error("PDF vazio.")
  }

  if (bytes.byteLength > maxBytes) {
    throw new Error(`PDF excede o limite de ${maxBytes} bytes.`)
  }

  const hasPdfHeader = PDF_HEADER.every((value, index) => bytes[index] === value)
  if (!hasPdfHeader) {
    throw new Error("PDF invalido.")
  }
}
export async function calculateSha256(bytes: Uint8Array): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex")
}

export function parsePdfDataUrl(value: string): Uint8Array {
  const match = /^data:application\/pdf;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value)
  if (!match) {
    throw new Error("Data URL PDF invalida.")
  }

  const bytes = new Uint8Array(Buffer.from(match[1], "base64"))
  assertPdfBytes(bytes)
  return bytes
}
