import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import jsPDF, { type jsPDFOptions } from "jspdf"
import { syntheticSignaturePng } from "./syntheticSignaturePng"

const mode = vi.hoisted(() => ({ compressed: true, logo: "" }))

// The optimized case uses the real production factory. Only the baseline uses
// the former constructor, with identical inputs, timestamps and document ID.
vi.mock("@/utils/pdfDocument", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/pdfDocument")>()
  return {
    ...actual,
    createPdfDocument: (options: jsPDFOptions) => {
      const doc = mode.compressed ? actual.createPdfDocument(options) : new jsPDF(options)
      doc.setCreationDate(new Date("2026-11-06T12:00:00Z"))
      doc.setFileId("0123456789ABCDEF0123456789ABCDEF")
      return doc
    },
  }
})

vi.mock("@/lib/brandTheme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brandTheme")>()
  return {
    ...actual,
    getStoredBrand: () => ({ name: "SafeEPI - DOCUMENTO FICTICIO", cnpj: null, logoUrl: null, logoDataUrl: mode.logo, primaryColor: "#2563EB" }),
  }
})

import { generateDeliveryPDF, generateNR06PDF, type DeliveryPDFData, type NR06PDFData } from "@/utils/pdfGenerator"

// An artificial curve, not a real person's signature; transparent RGBA PNG.
const signature = syntheticSignaturePng

const receipt: DeliveryPDFData = {
  employeeName: "COLABORADOR FICTICIO - TESTE DE COMPRESSAO",
  employeeCpf: "000.000.000-00", employeeRole: "OPERADOR DE TESTE", workplaceName: "UNIDADE FICTICIA",
  authMethod: "manual", signatureBase64: signature, validationHash: "DEMONSTRACAO-SEM-ENTREGA-REAL",
  ipAddress: "192.0.2.10", location: "CENARIO FICTICIO - SEM COORDENADAS REAIS",
  deliveryDate: "2026-11-06T12:00:00Z",
  items: [{ ppeName: "CAPACETE - ITEM DE TESTE", ppeCaNumber: "12345", quantity: 1, reason: "Primeira Entrega" }],
}

const employeeRecord: NR06PDFData = {
  employeeName: receipt.employeeName, employeeCpf: receipt.employeeCpf, employeeRole: receipt.employeeRole,
  employeeDepartment: "DEMONSTRACAO", workplaceName: receipt.workplaceName, admissionDate: "01/01/2026",
  items: Array.from({ length: 30 }, (_, index) => ({
    deliveryDate: "06/11/2026", ppeName: `EQUIPAMENTO FICTICIO ${index + 1}`, caNr: "12345", quantity: 1,
    reason: "Primeira Entrega", isExpired: false, authMethod: "manual", signatureBase64: signature,
  })),
  tstSigner: { name: "RESPONSAVEL FICTICIO", role: "TESTE SEM REGISTRO REAL", signatureBase64: signature, authMethod: "manual" },
}

function pdfBytes(blob: Blob) {
  return blob.arrayBuffer().then(buffer => Buffer.from(buffer))
}

function pages(bytes: Buffer) {
  return bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length || 0
}

function optionalArtifacts(name: string, baseline: Buffer, optimized: Buffer) {
  // Explicit opt-in for manual Poppler/Python verification. Normal tests never
  // create PDF files. The dedicated output directory contains no private data.
  if (process.env.SAFE_EPI_WRITE_PDF_QA !== "1") return
  const folder = path.resolve("output/pdf/new-pdf-compression-qa")
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, `${name}-baseline.pdf`), baseline, { flag: "wx" })
  writeFileSync(path.join(folder, `${name}-optimized.pdf`), optimized, { flag: "wx" })
  writeFileSync(path.join(folder, `${name}-sizes.json`), JSON.stringify({
    synthetic: true, originalArchivedFilesChanged: false, baselineBytes: baseline.length,
    optimizedBytes: optimized.length, reductionPercent: (1 - optimized.length / baseline.length) * 100,
  }, null, 2), { flag: "wx" })
}

describe("real PDF generator lossless compression", () => {
  beforeEach(() => {
    // Routine coverage runs exercise the same decoder with a bounded RGBA PNG.
    // Manual comparison artifacts intentionally use the large real public logo.
    mode.logo = process.env.SAFE_EPI_WRITE_PDF_QA === "1"
      ? `data:image/png;base64,${readFileSync(path.resolve("public/logo.png")).toString("base64")}`
      : signature
    mode.compressed = true
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"))
  })
  afterEach(() => vi.useRealTimers())

  it.each([
    ["receipt", () => generateDeliveryPDF(receipt)],
    ["employee-record", () => generateNR06PDF(employeeRecord)],
  ] as const)("keeps pagination and reduces the image-heavy %s without stubbing images", async (name, generate) => {
    mode.compressed = false
    const baseline = await pdfBytes(await generate())
    mode.compressed = true
    const optimized = await pdfBytes(await generate())
    expect(pages(optimized)).toBe(pages(baseline))
    expect(pages(optimized)).toBeGreaterThan(0)
    expect(optimized.toString("latin1")).toContain("/FlateDecode")
    expect(optimized.length).toBeLessThan(baseline.length * 0.3)
    expect(optimized.toString("latin1").match(/\/Subtype \/Image/g)?.length).toBe(baseline.toString("latin1").match(/\/Subtype \/Image/g)?.length)
    optionalArtifacts(name, baseline, optimized)
  }, 90_000)
})
