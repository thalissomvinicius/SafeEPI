import jsPDF from "jspdf"
import { describe, expect, it } from "vitest"
import { createPdfDocument, type PdfDocumentOptions } from "@/utils/pdfDocument"
import { pdfSource } from "./pdfContent"
import { syntheticSignaturePng } from "./syntheticSignaturePng"

describe("new PDF document compression", () => {
  it("uses compressed content streams while retaining text", async () => {
    const doc = createPdfDocument()
    doc.text("DOCUMENTO FICTICIO - teste de compactacao", 20, 20)
    const blob = doc.output("blob")
    const binary = Buffer.from(await blob.arrayBuffer()).toString("latin1")
    expect(binary).toContain("/FlateDecode")
    expect(await pdfSource(blob)).toContain("DOCUMENTO FICTICIO - teste de compactacao")
  })

  it("retains requested orientation, format and units", () => {
    const doc = createPdfDocument({ orientation: "landscape", format: [200, 100], unit: "mm" })
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(200)
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(100)
  })

  it("cannot accidentally disable compression through untyped legacy options", async () => {
    const doc = createPdfDocument({ compress: false, compressPdf: false, filters: [] } as unknown as PdfDocumentOptions)
    doc.text("Compression remains enabled", 20, 20)
    const blob = doc.output("blob")
    expect(Buffer.from(await blob.arrayBuffer()).toString("latin1")).toContain("/FlateDecode")
    expect(await pdfSource(blob)).toContain("Compression remains enabled")
  })

  it("substantially reduces a real PNG without changing its pixel dimensions", () => {
    const png = syntheticSignaturePng
    const plain = new jsPDF({ format: "a4" })
    const compressed = createPdfDocument({ format: "a4" })
    for (const doc of [plain, compressed]) {
      doc.text("DOCUMENTO FICTICIO", 20, 20)
      doc.addImage(png, "PNG", 20, 30, 24, 19.2)
    }
    const before = plain.output("arraybuffer")
    const after = compressed.output("arraybuffer")
    const properties = plain.getImageProperties(png)
    const output = Buffer.from(after).toString("latin1")
    expect(after.byteLength).toBeLessThan(before.byteLength * 0.3)
    expect(output).toContain(`/Width ${properties.width}`)
    expect(output).toContain(`/Height ${properties.height}`)
    expect(compressed.getImageProperties(png).width).toBe(properties.width)
    expect(compressed.getImageProperties(png).height).toBe(properties.height)
  }, 30_000)
})
