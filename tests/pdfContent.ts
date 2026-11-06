import { inflateSync } from "node:zlib"

/** Inspect jsPDF fixtures with direct stream lengths. Not a general PDF parser.
 * Image bytes are omitted; text/drawing operators are decoded before assertions.
 */
export async function pdfSource(blob: Blob): Promise<string> {
  const bytes = Buffer.from(await blob.arrayBuffer())
  const source = bytes.toString("latin1")
  const streams = /\bstream\r?\n/g
  const pieces: string[] = []
  let copiedUntil = 0
  let match: RegExpExecArray | null
  while ((match = streams.exec(source))) {
    const header = source.slice(source.lastIndexOf(" obj", match.index), match.index)
    const length = /\/Length\s+(\d+)\b/.exec(header)
    if (!length) throw new Error("Fixture stream has no direct length")
    const dataStart = streams.lastIndex
    const dataEnd = dataStart + Number(length[1])
    if (dataEnd > bytes.length || !/^\s*endstream\b/.test(source.slice(dataEnd, dataEnd + 24))) {
      throw new Error("Fixture stream length is invalid")
    }
    pieces.push(source.slice(copiedUntil, dataStart))
    if (/\/Subtype\s*\/Image\b/.test(header)) {
      pieces.push("[image bytes omitted]")
    } else {
      const body = bytes.subarray(dataStart, dataEnd)
      pieces.push((/\/Filter\s*(?:\[\s*)?\/FlateDecode\b/.test(header) ? inflateSync(body) : body).toString("latin1"))
    }
    copiedUntil = dataEnd
    streams.lastIndex = dataEnd
  }
  pieces.push(source.slice(copiedUntil))
  return pieces.join("")
}
