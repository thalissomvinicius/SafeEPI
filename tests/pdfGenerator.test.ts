import { beforeEach, describe, expect, it, vi } from "vitest"
import type { jsPDF, TextOptionsLight } from "jspdf"
import QRCode from "qrcode"
import type { DeliveryWithRelations, PPE } from "@/types/database"

const rendered = vi.hoisted(() => ({
  texts: [] as { value: string; x: number; y: number; width: number; page: number; align: string }[],
  pages: 0,
}))

// Keep real jsPDF font measurement, pagination and autoTable; only image decoding is stubbed.
vi.mock("jspdf", async (importOriginal) => {
  const original = await importOriginal<typeof import("jspdf")>()
  return {
    ...original,
    default: class {
      constructor(options: ConstructorParameters<typeof original.jsPDF>[0]) {
        const doc = new original.jsPDF(options)
        const text = doc.text.bind(doc)
        doc.text = ((value: string | string[], x: number, y: number, options?: TextOptionsLight) => {
          for (const line of Array.isArray(value) ? value : [value]) {
            rendered.texts.push({ value: line, x, y, width: doc.getTextWidth(line), page: doc.getCurrentPageInfo().pageNumber, align: options?.align || "left" })
          }
          rendered.pages = doc.getNumberOfPages()
          return text(value, x, y, options)
        }) as jsPDF["text"]
        doc.addImage = vi.fn(() => doc) as jsPDF["addImage"]
        doc.getImageProperties = vi.fn(() => ({ width: 400, height: 480 })) as unknown as jsPDF["getImageProperties"]
        return doc
      }
    },
  }
})

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,synthetic") } }))

import { EPI_RESPONSIBILITY_TERM, generateNR06PDF, generateDeliveryPDF, generateReturnPDF, generateInventoryStockReportPDF, generateMovementsPresentationPDF, generateMovementsSimplePDF, type DeliveryPDFData } from "@/utils/pdfGenerator"

const shortDelivery: DeliveryPDFData = {
  employeeName: "COLABORADOR SINTÉTICO DE TESTE",
  employeeCpf: "000.000.000-00",
  employeeRole: "OPERADOR DE EQUIPAMENTOS",
  workplaceName: "UNIDADE DE HOMOLOGAÇÃO",
  authMethod: "manual_facial",
  signatureBase64: "data:image/png;base64,synthetic",
  photoBase64: "data:image/png;base64,synthetic",
  ipAddress: "192.0.2.10",
  location: "Coordenadas não capturadas — cenário sintético",
  deliveryDate: "2026-10-13T12:00:00Z",
  validationHash: "TESTE-CURTO-20261013",
  items: [
    { ppeName: "Capacete de segurança", ppeCaNumber: "12345", caExpiry: "2028-10-13", quantity: 1, reason: "Primeira Entrega" },
    { ppeName: "Óculos de proteção", ppeCaNumber: "54321", caExpiry: "2029-10-13", quantity: 2, reason: "Substituição (Desgaste/Validade)" },
  ],
}

const syntheticMovements = (count: number): DeliveryWithRelations[] => Array.from({ length: count }, (_, index) => ({
  id: `synthetic-movement-${index + 1}`,
  employee_id: "synthetic-employee",
  ppe_id: `synthetic-ppe-${index + 1}`,
  delivery_date: "2026-10-13T12:00:00Z",
  reason: "Primeira Entrega",
  quantity: 1,
  signature_url: null,
  ip_address: null,
  workplace_id: "synthetic-workplace",
  employee: { full_name: "COLABORADOR DE HOMOLOGAÇÃO", cpf: "000.000.000-00" },
  ppe: { name: `EQUIPAMENTO ${String(index + 1).padStart(3, "0")}`, ca_number: "12345", cost: 17.35 },
  workplace: { name: "UNIDADE DE TESTE" },
}))

function expectNumberedPages() {
  for (let page = 1; page <= rendered.pages; page += 1) {
    expect(rendered.texts.some(entry => entry.page === page && entry.value === `Página ${page} de ${rendered.pages}`)).toBe(true)
  }
}

function expectTextInsideHorizontalMargins(pageWidth: number) {
  for (const entry of rendered.texts) {
    const left = entry.align === "center" ? entry.x - entry.width / 2 : entry.align === "right" ? entry.x - entry.width : entry.x
    expect(left, entry.value).toBeGreaterThanOrEqual(13.5)
    expect(left + entry.width, entry.value).toBeLessThanOrEqual(pageWidth - 13.5)
  }
}

describe("paginação e margens do comprovante de entrega", () => {
  beforeEach(() => {
    rendered.texts.splice(0)
    rendered.pages = 0
  })

  it("inclui o termo integral antes dos dados e da tabela do prontuário", async () => {
    await generateNR06PDF({
      employeeName: "COLABORADOR TESTE", employeeCpf: "000.000.000-00", employeeRole: "OPERADOR",
      employeeDepartment: "OBRA", workplaceName: "UNIDADE", admissionDate: "01/01/2026",
      items: [{ deliveryDate: "13/10/2026", ppeName: "CAPACETE", caNr: "12345", quantity: 1, reason: "Primeira Entrega", isExpired: false }],
    })
    const text = rendered.texts.map(entry => entry.value).join(" ").replace(/\s+/g, " ")
    expect(text).toContain(EPI_RESPONSIBILITY_TERM.title)
    for (const paragraph of EPI_RESPONSIBILITY_TERM.paragraphs) expect(text).toContain(paragraph)
    expect(text.indexOf(EPI_RESPONSIBILITY_TERM.title)).toBeLessThan(text.indexOf("COLABORADOR TESTE"))
    expect(text.indexOf(EPI_RESPONSIBILITY_TERM.paragraphs[2])).toBeLessThan(text.indexOf("CAPACETE"))
  })

  it("preserva todos os itens e cabeçalhos no prontuário com múltiplas páginas", async () => {
    await generateNR06PDF({
      employeeName: "COLABORADOR COM NOME MUITO EXTENSO PARA TESTAR A QUEBRA DE LINHAS",
      employeeCpf: "000.000.000-00", employeeRole: "OPERADOR", employeeDepartment: "OBRA",
      workplaceName: "UNIDADE", admissionDate: "01/01/2026",
      items: Array.from({ length: 40 }, (_, i) => ({ deliveryDate: "13/10/2026", ppeName: `EQUIPAMENTO ${i + 1}`, caNr: "12345", quantity: 1, reason: "Primeira Entrega", isExpired: false, signatureBase64: "data:image/png;base64,synthetic" })),
      tstSigner: { name: "RESPONSÁVEL TÉCNICO COM NOME LONGO PARA QUEBRAR LINHAS", role: "TÉCNICO DE SEGURANÇA", signatureBase64: "data:image/png;base64,synthetic", authMethod: "manual" },
    })
    expect(rendered.pages).toBeGreaterThan(1)
    for (let i = 1; i <= 40; i++) expect(rendered.texts.some(entry => entry.value === `EQUIPAMENTO ${i}`)).toBe(true)
    for (let page = 1; page <= rendered.pages; page++) {
      expect(rendered.texts.some(entry => entry.page === page && entry.value === "FICHA DE CONTROLE DE EPI - NR-06")).toBe(true)
      expect(rendered.texts.some(entry => entry.value === `Página ${page} de ${rendered.pages}`)).toBe(true)
    }
    const signatureLabel = rendered.texts.find(entry => entry.value === "ASSINATURA DO RESPONSÁVEL TÉCNICO")!
    expect(signatureLabel.y).toBeLessThan(247)
  })

  it("mantém a entrega curta com assinatura, foto e QR em uma página", async () => {
    await generateDeliveryPDF(shortDelivery)
    expect(rendered.pages).toBe(1)
  })

  it("preserva a modalidade digital e toda a evidência do terminal sem tratá-la como assinatura manual", async () => {
    await generateDeliveryPDF({
      ...shortDelivery,
      authMethod: "fingerprint",
      signatureBase64: undefined,
      photoBase64: undefined,
      fingerprintEvidence: { code: "FP-HOMOLOGACAO", terminalName: "TERMINAL DE HOMOLOGAÇÃO", completedAt: "2026-10-13T12:00:00Z", resultHash: "a".repeat(64) },
    })
    const text = rendered.texts.map(entry => entry.value).join(" ")
    expect(text).toContain("Confirmação por impressão digital registrada")
    expect(text).toContain("FP-HOMOLOGACAO")
    expect(text.replace(/\s/g, "")).toContain("a".repeat(64))
    expect(text).not.toContain("Assinatura manual pendente")
    expectNumberedPages()
  })

  it("quebra os textos do recibo de devolução sem exceder a largura da página", async () => {
    await generateReturnPDF({
      employeeName: "COLABORADOR COM NOME EXTENSO PARA VALIDAR O RECIBO E SUAS MARGENS",
      employeeCpf: "000.000.000-00",
      workplaceName: "UNIDADE DE HOMOLOGAÇÃO COM DESCRIÇÃO EXTENSA PARA A ATIVIDADE INDUSTRIAL",
      returnedItemName: "EQUIPAMENTO COM DESCRIÇÃO MUITO EXTENSA PARA OPERAÇÃO E MANUTENÇÃO INDUSTRIAL ".repeat(3),
      returnMotive: "Desgaste natural identificado durante inspeção periódica, com necessidade de substituir o equipamento.",
      newItemName: "NOVO EQUIPAMENTO DE PROTEÇÃO COM DESCRIÇÃO EXTENSA PARA A ATIVIDADE INDUSTRIAL",
      newItemCa: "12345",
      authMethod: "manual",
      signatureBase64: "data:image/png;base64,synthetic",
      validationHash: "HOMOLOGACAO-" + "B".repeat(120),
    })
    expectTextInsideHorizontalMargins(210)
    expectNumberedPages()
  })

  it("mantém as colunas do estoque dentro das margens e numera todas as páginas", () => {
    const ppes: PPE[] = syntheticMovements(60).map((movement, index) => ({
      id: movement.ppe_id, name: movement.ppe!.name, manufacturer: "FABRICANTE DE HOMOLOGAÇÃO", ca_number: "12345", ca_expiry_date: "2029-10-13",
      lifespan_days: 180, cost: 17.35, active: true, current_stock: index + 1,
    }))
    generateInventoryStockReportPDF({ ppes, filterLabel: "Homologação de margens" })
    expect(rendered.pages).toBeGreaterThan(1)
    expectTextInsideHorizontalMargins(297)
    expectNumberedPages()
    expect(rendered.texts.some(entry => entry.value === "EQUIPAMENTO 060")).toBe(true)
  })

  it("repete cabeçalhos e rodapés no relatório simples de movimentações", () => {
    generateMovementsSimplePDF({ movements: syntheticMovements(60), stats: { deliveries: 60, returns: 0, totalItems: 60, uniqueEmployees: 1 }, period: "Outubro de 2026" })
    expect(rendered.pages).toBeGreaterThan(1)
    expectNumberedPages()
    for (let page = 1; page <= rendered.pages; page += 1) {
      expect(rendered.texts.some(entry => entry.page === page && entry.value === "RELATÓRIO DE MOVIMENTAÇÕES")).toBe(true)
    }
  })

  it("reserva o responsável técnico depois da última linha e usa a quantidade real de páginas no relatório completo", async () => {
    await generateMovementsPresentationPDF({
      movements: syntheticMovements(60), stats: { deliveries: 60, returns: 0, totalItems: 60, uniqueEmployees: 1 }, period: "Outubro de 2026",
      technicianName: "RESPONSÁVEL TÉCNICO DE HOMOLOGAÇÃO", technicianRole: "TÉCNICO DE SEGURANÇA", technicianSignatureBase64: "data:image/png;base64,synthetic",
    })
    expect(rendered.pages).toBeGreaterThan(2)
    expectNumberedPages()
    const lastItem = rendered.texts.find(entry => entry.value.includes("EQUIPAMENTO 060"))!
    const technicianName = rendered.texts.find(entry => entry.value === "RESPONSÁVEL TÉCNICO DE HOMOLOGAÇÃO")!
    expect(lastItem).toBeDefined()
    expect(technicianName.page).toBeGreaterThanOrEqual(lastItem.page)
    if (technicianName.page === lastItem.page) expect(technicianName.y).toBeGreaterThan(lastItem.y + 12)
    expect(technicianName.y).toBeLessThan(186)
  })

  it("mantém o QR junto do código do registro, nunca numa página isolada", async () => {
    await generateDeliveryPDF({
      ...shortDelivery,
      items: Array.from({ length: 35 }, (_, index) => ({
        ppeName: `ITEM ${index + 1} — EQUIPAMENTO DE PROTEÇÃO COM DESCRIÇÃO LONGA PARA OPERAÇÃO INDUSTRIAL`,
        ppeCaNumber: "12345", quantity: 1, reason: "Substituição (Desgaste/Validade)",
      })),
    })
    const qrCaption = rendered.texts.find(entry => entry.value === "QR de referência do registro")
    const codeLabel = rendered.texts.find(entry => entry.value === "CÓDIGO DE REFERÊNCIA")
    expect(qrCaption?.page).toBe(codeLabel?.page)
  })

  it.each([false, true])("quebra referências sem espaços sem invadir a margem nem perder caracteres (QR indisponível: %s)", async qrUnavailable => {
    if (qrUnavailable) vi.mocked(QRCode.toDataURL).mockRejectedValueOnce(new Error("QR indisponível"))
    const reference = "TESTE-LONGO-" + "A".repeat(128)
    await generateDeliveryPDF({ ...shortDelivery, validationHash: reference })
    const start = rendered.texts.findIndex(entry => entry.value === "CÓDIGO DE REFERÊNCIA") + 1
    const end = rendered.texts.findIndex((entry, index) => index >= start && entry.value === "IP DO TERMINAL")
    const referenceLines = rendered.texts.slice(start, end).filter(entry => entry.value.startsWith("TESTE-LONGO-") || /^A+$/.test(entry.value))
    expect(referenceLines.map(entry => entry.value).join("")).toBe(reference)
    for (const entry of referenceLines) {
      // jsPDF rounds Helvetica metrics (e.g. A=0.66 instead of 0.667 em).
      // Keep breathing room so a renderer's precise glyph metrics also fit.
      expect(entry.x + entry.width, entry.value).toBeLessThanOrEqual(195)
    }
  })
})
