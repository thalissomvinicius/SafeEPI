import * as XLSX from "xlsx"
import { format } from "date-fns"
import { COMPANY_CONFIG } from "@/config/company"
import { DeliveryWithRelations } from "@/types/database"

function addHeaderToSheet(ws: XLSX.WorkSheet, title: string) {
  const headerData = [
    [`${COMPANY_CONFIG.name.toUpperCase()} - ${COMPANY_CONFIG.systemName.toUpperCase()}`],
    [`Relatorio: ${title}`],
    [`Exportado em: ${format(new Date(), "dd/MM/yyyy HH:mm")} | Compliance NR-06`],
    [],
  ]

  XLSX.utils.sheet_add_aoa(ws, headerData, { origin: "A1" })
}

function styleWorksheet(ws: XLSX.WorkSheet, colCount: number) {
  const colWidths = []

  for (let i = 0; i < colCount; i++) {
    colWidths.push({ wch: 22 })
  }

  if (colWidths.length > 1) {
    colWidths[1] = { wch: 35 }
  }

  ws["!cols"] = colWidths
}

export function exportDeliveriesToExcel(deliveries: DeliveryWithRelations[]) {
  const wb = XLSX.utils.book_new()

  const rows = deliveries.map((delivery) => ({
    "Data Entrega": delivery.delivery_date ? format(new Date(delivery.delivery_date), "dd/MM/yyyy") : "",
    Colaborador: delivery.employee?.full_name || "",
    CPF: delivery.employee?.cpf || "",
    Cargo: delivery.employee?.job_title || "",
    EPI: delivery.ppe?.name || "",
    "No. C.A.": delivery.ppe?.ca_number || "",
    Quantidade: delivery.quantity || 1,
    Motivo: delivery.reason || "",
    Canteiro: delivery.workplace?.name || "Sede",
    Status: delivery.returned_at ? "Devolvido" : "Em Uso",
    "Data Devolucao": delivery.returned_at ? format(new Date(delivery.returned_at), "dd/MM/yyyy") : "",
    "Custo Unitario (R$)": delivery.ppe?.cost || 0,
    "Custo Total (R$)": (delivery.ppe?.cost || 0) * (delivery.quantity || 1),
  }))

  const ws = XLSX.utils.aoa_to_sheet([])
  addHeaderToSheet(ws, "Historico Geral de Entregas")
  XLSX.utils.sheet_add_json(ws, rows, { origin: "A5" })
  styleWorksheet(ws, Object.keys(rows[0] || {}).length)
  XLSX.utils.book_append_sheet(wb, ws, "Entregas")

  const ppeMap: Record<string, { qtd: number; custo: number }> = {}
  deliveries.forEach((delivery) => {
    const name = delivery.ppe?.name || "Desconhecido"
    if (!ppeMap[name]) ppeMap[name] = { qtd: 0, custo: 0 }
    ppeMap[name].qtd += delivery.quantity || 1
    ppeMap[name].custo += (delivery.ppe?.cost || 0) * (delivery.quantity || 1)
  })

  const summaryRows = Object.entries(ppeMap)
    .map(([epi, { qtd, custo }]) => ({
      EPI: epi,
      "Total Entregue": qtd,
      "Custo Total (R$)": custo,
    }))
    .sort((a, b) => b["Total Entregue"] - a["Total Entregue"])

  const wsSummary = XLSX.utils.aoa_to_sheet([])
  addHeaderToSheet(wsSummary, "Resumo por EPI")
  XLSX.utils.sheet_add_json(wsSummary, summaryRows, { origin: "A5" })
  styleWorksheet(wsSummary, 3)
  XLSX.utils.book_append_sheet(wb, wsSummary, "Resumo por EPI")

  const workplaceMap: Record<string, { qtd: number; custo: number }> = {}
  deliveries.forEach((delivery) => {
    const name = delivery.workplace?.name || "Sede"
    if (!workplaceMap[name]) workplaceMap[name] = { qtd: 0, custo: 0 }
    workplaceMap[name].qtd += delivery.quantity || 1
    workplaceMap[name].custo += (delivery.ppe?.cost || 0) * (delivery.quantity || 1)
  })

  const workplaceRows = Object.entries(workplaceMap)
    .map(([canteiro, { qtd, custo }]) => ({
      Canteiro: canteiro,
      Entregas: qtd,
      "Investimento Total (R$)": custo,
    }))
    .sort((a, b) => b["Investimento Total (R$)"] - a["Investimento Total (R$)"])

  const wsWorkplaces = XLSX.utils.aoa_to_sheet([])
  addHeaderToSheet(wsWorkplaces, "Resumo por Canteiro")
  XLSX.utils.sheet_add_json(wsWorkplaces, workplaceRows, { origin: "A5" })
  styleWorksheet(wsWorkplaces, 3)
  XLSX.utils.book_append_sheet(wb, wsWorkplaces, "Resumo Canteiros")

  const fileName = `Relatorio_EPIs_${COMPANY_CONFIG.shortName}_${format(new Date(), "yyyy-MM-dd")}.xlsx`
  XLSX.writeFile(wb, fileName)
}

export function exportEmployeeToExcel(
  employeeName: string,
  deliveries: DeliveryWithRelations[]
) {
  const wb = XLSX.utils.book_new()

  const rows = deliveries.map((delivery) => ({
    "Data Entrega": delivery.delivery_date ? format(new Date(delivery.delivery_date), "dd/MM/yyyy") : "",
    EPI: delivery.ppe?.name || "",
    "No. C.A.": delivery.ppe?.ca_number || "",
    Quantidade: delivery.quantity || 1,
    Motivo: delivery.reason || "",
    Status: delivery.returned_at ? "Devolvido" : "Em Uso",
    "Data Devolucao": delivery.returned_at ? format(new Date(delivery.returned_at), "dd/MM/yyyy") : "-",
    "Custo (R$)": delivery.ppe?.cost || 0,
  }))

  const ws = XLSX.utils.aoa_to_sheet([])
  addHeaderToSheet(ws, `Prontuario Individual: ${employeeName}`)
  XLSX.utils.sheet_add_json(ws, rows, { origin: "A5" })
  styleWorksheet(ws, 8)
  XLSX.utils.book_append_sheet(wb, ws, "Prontuario")

  XLSX.writeFile(wb, `Prontuario_${employeeName.replace(/\s+/g, "_")}.xlsx`)
}
