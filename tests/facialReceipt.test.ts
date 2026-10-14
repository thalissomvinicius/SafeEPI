import { beforeEach, describe, expect, it, vi } from "vitest"
import type { jsPDF, TextOptionsLight } from "jspdf"

const captures = vi.hoisted(() => ({
  texts: [] as { text: string; x: number; y: number; width: number; page: number; align: string }[],
}))

vi.mock("jspdf", async (importOriginal) => {
  const original = await importOriginal<typeof import("jspdf")>()
  return {
    ...original,
    default: class {
      constructor(options: ConstructorParameters<typeof original.jsPDF>[0]) {
        const doc = new original.jsPDF(options)
        const text = doc.text.bind(doc)
        doc.text = ((value: string | string[], x: number, y: number, options?: TextOptionsLight) => {
          const lines = Array.isArray(value) ? value : [value]
          const lineHeight = doc.getFontSize() / doc.internal.scaleFactor * doc.getLineHeightFactor()
          lines.forEach((line, index) => captures.texts.push({
            text: line,
            x,
            y: y + index * lineHeight,
            width: doc.getTextWidth(line),
            page: doc.getCurrentPageInfo().pageNumber,
            align: options?.align || "left",
          }))
          return text(value, x, y, options)
        }) as jsPDF["text"]
        doc.addImage = vi.fn(() => doc) as jsPDF["addImage"]
        doc.getImageProperties = vi.fn(() => ({ width: 300, height: 300 })) as unknown as jsPDF["getImageProperties"]
        return doc
      }
    },
  }
})

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,fixture") } }))

import { generateDeliveryPDF, generateEmployeesReportPDF, type DeliveryPDFData } from "@/utils/pdfGenerator"

const base: DeliveryPDFData = {
  employeeName: "Maria de Souza",
  employeeCpf: "000.000.000-00",
  employeeRole: "Operadora",
  workplaceName: "Unidade central",
  authMethod: "facial",
  signatureBase64: "data:image/jpeg;base64,fixture",
  items: [{ ppeName: "Capacete", ppeCaNumber: "12345", quantity: 1, reason: "Primeira Entrega" }],
  deliveryDate: "2026-10-13T14:00:00Z",
}

const receipt = {
  session_id: "de65f049-1b21-4aeb-9795-c26f0458ddfc",
  accepted_at: "2026-10-13T14:00:00Z",
  model_id: "sface-2021dec",
  calibration_id: "homologacao-2026-10",
  context_hash: "a".repeat(64),
  similarity: 0.81,
  threshold: 0.7,
  pad_model_id: "pad-qualified-v1",
}

function fullText() { return captures.texts.map(item => item.text).join(" ") }

describe("comprovante facial de entrega", () => {
  beforeEach(() => captures.texts.splice(0))

  it("não declara verificação de identidade apenas pelo método facial legado", async () => {
    await generateDeliveryPDF(base)
    expect(fullText()).toContain("Registro fotográfico")
    expect(fullText()).toContain("verificação biométrica não comprovada neste arquivo")
    expect(fullText()).not.toMatch(/Identidade validada|Identidade Digital Verificada|Faceplugin|AUTENTICAÇÃO BIOMÉTRICA/)
  })

  it("identifica assinatura manual com foto sem atribuir validação biométrica", async () => {
    await generateDeliveryPDF({ ...base, authMethod: "manual_facial", photoBase64: base.signatureBase64 })
    expect(fullText()).toContain("Assinatura manual com foto de apoio")
    expect(fullText()).not.toContain("Verificação facial registrada")
  })

  it("preserva a alternativa de assinatura manual no papel quando não há imagem", async () => {
    await generateDeliveryPDF({ ...base, authMethod: "manual", signatureBase64: undefined })
    expect(fullText()).toContain("Assinatura manual pendente")
    expect(fullText()).toContain("Assinar manualmente sobre a linha")
    expect(fullText()).not.toContain("Verificação facial registrada")
  })

  it("não apresenta presença de foto no cadastro como biometria cadastrada", () => {
    generateEmployeesReportPDF({ employees: [{
      id: "employee-fixture", full_name: "Maria", cpf: "000.000.000-00", job_title: "Operadora",
      department: null, active: true, workplace_id: null, photo_url: "https://example.invalid/photo.jpg",
    }] })
    expect(fullText()).not.toMatch(/biometria/i)
    expect(fullText()).toContain("COM FOTO")
  })

  it("exibe a prova derivada pelo servidor e aceite expresso", async () => {
    await generateDeliveryPDF({ ...base, biometricReceipt: receipt })
    expect(fullText()).toContain("Verificação facial registrada")
    expect(fullText()).toContain(receipt.session_id)
    expect(fullText()).toContain(receipt.model_id)
    expect(fullText()).toContain(receipt.calibration_id)
    expect(fullText()).toContain("ACEITE DO RECEBIMENTO")
    expect(fullText()).not.toContain("Certificado de Uso Individual")
    expect(fullText()).not.toContain("Scan to Verify")
  })

  it.each([
    { ...receipt, accepted_at: "" },
    { ...receipt, model_id: "" },
    { ...receipt, calibration_id: "" },
    { ...receipt, context_hash: "invalido" },
    { ...receipt, accepted_at: "data-invalida" },
  ])("não eleva metadados incompletos a prova biométrica", async invalidReceipt => {
    await generateDeliveryPDF({ ...base, biometricReceipt: invalidReceipt })
    expect(fullText()).not.toContain("Verificação facial registrada")
    expect(fullText()).toContain("verificação biométrica não comprovada neste arquivo")
  })

  it("mantém nomes extensos, prova, tabela e rodapé dentro das margens em múltiplas páginas", async () => {
    await generateDeliveryPDF({
      ...base,
      employeeName: "COLABORADOR COM NOME LONGO ".repeat(10),
      employeeRole: "Cargo com descrição extensa ".repeat(6),
      workplaceName: "Unidade com localização extensa ".repeat(6),
      location: "Coordenadas indisponíveis: permissão negada ".repeat(8),
      validationHash: "b".repeat(64),
      biometricReceipt: { ...receipt, model_id: "modelo-".repeat(60), calibration_id: "calibracao-".repeat(40) },
      items: Array.from({ length: 35 }, (_, index) => ({ ppeName: `Item ${index} com descrição longa`, ppeCaNumber: "12345", quantity: 1, reason: "Primeira Entrega" })),
    })
    expect(Math.max(...captures.texts.map(item => item.page))).toBeGreaterThan(1)
    for (const entry of captures.texts.filter(item => item.text)) {
      const left = entry.align === "center" ? entry.x - entry.width / 2 : entry.align === "right" ? entry.x - entry.width : entry.x
      expect(left, entry.text).toBeGreaterThanOrEqual(13.5)
      expect(left + entry.width, entry.text).toBeLessThanOrEqual(196.6)
      expect(entry.y, entry.text).toBeGreaterThanOrEqual(7)
      expect(entry.y, entry.text).toBeLessThanOrEqual(291.5)
    }
  })
})
