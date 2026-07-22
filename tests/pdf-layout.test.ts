import { describe, expect, it } from "vitest"

import { generateDeliveryPDF, generateNR06PDF } from "@/utils/pdfGenerator"

const signaturePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAbCAYAAACwRpUzAAAAUUlEQVR4AWNwL/CBYyAwRuajSMAwTAxFAl0BWAIXBunEifFKEjYWmwRBrxAMBJyYMq/8x4WhKjAlYMZiKMDllf+Uupb+kgS9QjAQcAYfwYAHAE7jpLivkXjUAAAAAElFTkSuQmCC"

async function pdfSource(blob: Blob) {
  return new TextDecoder("latin1").decode(await blob.arrayBuffer())
}

function pageCount(source: string) {
  return source.match(/\/Type\s*\/Page\b/g)?.length || 0
}

describe("layout dos PDFs juridicos", () => {
  it("move os blocos juridicos da entrega para uma pagina segura quando a tabela cresce", async () => {
    const blob = await generateDeliveryPDF({
      employeeName: "COLABORADOR COM NOME EXTENSO PARA VALIDAR OS LIMITES DO DOCUMENTO",
      employeeCpf: "000.000.000-00",
      employeeRole: "TECNICO DE SEGURANCA DO TRABALHO COM FUNCAO EXTENSA",
      workplaceName: "UNIDADE OPERACIONAL COM NOME MUITO EXTENSO",
      authMethod: "manual",
      signatureBase64: signaturePng,
      validationHash: "TESTE123",
      location: "-2.851629, -48.232028",
      items: Array.from({ length: 23 }, (_, index) => ({
        ppeName: `EQUIPAMENTO DE PROTECAO INDIVIDUAL ${index + 1}`,
        ppeCaNumber: String(10000 + index),
        quantity: 1,
        reason: "Substituicao por desgaste e validade do equipamento",
      })),
    })

    expect(pageCount(await pdfSource(blob))).toBeGreaterThanOrEqual(3)
  })

  it("mantem assinaturas e responsavel tecnico em paginas reservadas da ficha NR-06", async () => {
    const blob = await generateNR06PDF({
      employeeName: "COLABORADOR TESTE",
      employeeCpf: "000.000.000-00",
      employeeRole: "OPERADOR",
      employeeDepartment: "OPERACOES",
      workplaceName: "UNIDADE TESTE",
      admissionDate: "01/01/2026",
      items: Array.from({ length: 23 }, (_, index) => ({
        deliveryDate: "20/07/2026",
        ppeName: `EPI ${index + 1}`,
        caNr: String(20000 + index),
        quantity: 1,
        reason: "SubstituiÃ§Ã£o (Desgaste/Validade)",
        isExpired: false,
        authMethod: "manual" as const,
        signatureBase64: signaturePng,
      })),
      tstSigner: {
        name: "RESPONSAVEL TECNICO",
        role: "Tecnico de Seguranca do Trabalho",
        signatureBase64: signaturePng,
        authMethod: "manual",
      },
    })

    const source = await pdfSource(blob)
    expect(pageCount(source)).toBeGreaterThanOrEqual(3)
    expect(source.match(/\/I\d+\s+Do\b/g)?.length || 0).toBeGreaterThan(20)
    expect(source).not.toContain("SubstituiÃ§Ã£o")
  })
})
