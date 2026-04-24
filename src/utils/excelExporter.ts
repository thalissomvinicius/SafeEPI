import * as XLSX from "xlsx"
import { format } from "date-fns"
import { COMPANY_CONFIG } from "@/config/company"
import { DeliveryWithRelations } from "@/types/database"

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function addHeaderToSheet(ws: XLSX.WorkSheet, title: string) {
  const headerData = [
    [`${COMPANY_CONFIG.name.toUpperCase()} — ${COMPANY_CONFIG.systemName.toUpperCase()}`],
    [`Relatório: ${title}`],
    [`Exportado em: ${format(new Date(), "dd/MM/yyyy HH:mm")} | Compliance NR-06`],
    [] // Blank row before data
  ]
  XLSX.utils.sheet_add_aoa(ws, headerData, { origin: "A1" })
}

// ─────────────────────────────────────────────
// 1. Relatório Geral de Entregas
// ─────────────────────────────────────────────

export function exportDeliveriesToExcel(deliveries: DeliveryWithRelations[]) {
  const wb = XLSX.utils.book_new()

  // Sheet 1: Todas as Entregas
  const rows = deliveries.map(d => ({
    "Data Entrega": d.delivery_date ? format(new Date(d.delivery_date), "dd/MM/yyyy") : "",
    "Colaborador": d.employee?.full_name || "",
    "CPF": d.employee?.cpf || "",
    "Cargo": d.employee?.job_title || "",
    "EPI": d.ppe?.name || "",
    "Nº C.A.": d.ppe?.ca_number || "",
    "Quantidade": d.quantity || 1,
    "Motivo": d.reason || "",
    "Canteiro": d.workplace?.name || "Sede",
    "Status": d.returned_at ? "Devolvido" : "Em Uso",
    "Data Devolução": d.returned_at ? format(new Date(d.returned_at), "dd/MM/yyyy") : "",
    "Custo Unitário (R$)": d.ppe?.cost || 0,
    "Custo Total (R$)": (d.ppe?.cost || 0) * (d.quantity || 1),
  }))

  const ws = XLSX.utils.json_to_sheet(rows, { origin: "A5" })
  addHeaderToSheet(ws, "Histórico Geral de Entregas")
  styleWorksheet(ws, Object.keys(rows[0] || {}).length)

  XLSX.utils.book_append_sheet(wb, ws, "Entregas")

  // Sheet 2: Resumo por EPI
  const ppeMap: Record<string, { qtd: number; custo: number }> = {}
  deliveries.forEach(d => {
    const name = d.ppe?.name || "Desconhecido"
    if (!ppeMap[name]) ppeMap[name] = { qtd: 0, custo: 0 }
    ppeMap[name].qtd += d.quantity || 1
    ppeMap[name].custo += (d.ppe?.cost || 0) * (d.quantity || 1)
  })
  const summaryRows = Object.entries(ppeMap)
    .map(([epi, { qtd, custo }]) => ({ "EPI": epi, "Total Entregue": qtd, "Custo Total (R$)": custo }))
    .sort((a, b) => b["Total Entregue"] - a["Total Entregue"])

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows, { origin: "A5" })
  addHeaderToSheet(wsSummary, "Resumo por EPI")
  styleWorksheet(wsSummary, 3)
  XLSX.utils.book_append_sheet(wb, wsSummary, "Resumo por EPI")

  // Sheet 3: Resumo por Canteiro
  const wpMap: Record<string, { qtd: number; custo: number }> = {}
  deliveries.forEach(d => {
    const name = d.workplace?.name || "Sede"
    if (!wpMap[name]) wpMap[name] = { qtd: 0, custo: 0 }
    wpMap[name].qtd += d.quantity || 1
    wpMap[name].custo += (d.ppe?.cost || 0) * (d.quantity || 1)
  })
  const wpRows = Object.entries(wpMap)
    .map(([canteiro, { qtd, custo }]) => ({ "Canteiro": canteiro, "Entregas": qtd, "Investimento Total (R$)": custo }))
    .sort((a, b) => b["Investimento Total (R$)"] - a["Investimento Total (R$)"])

  const wsWp = XLSX.utils.json_to_sheet(wpRows, { origin: "A5" })
  addHeaderToSheet(wsWp, "Resumo por Canteiro")
  styleWorksheet(wsWp, 3)
  XLSX.utils.book_append_sheet(wb, wsWp, "Resumo Canteiros")

  const fileName = `Relatorio_EPIs_${COMPANY_CONFIG.shortName}_${format(new Date(), "yyyy-MM-dd")}.xlsx`
  XLSX.writeFile(wb, fileName)
}

// ─────────────────────────────────────────────
// 2. Prontuário Individual em Excel
// ─────────────────────────────────────────────

export function exportEmployeeToExcel(
  employeeName: string,
  deliveries: DeliveryWithRelations[]
) {
  const wb = XLSX.utils.book_new()

  const rows = deliveries.map(d => ({
    "Data Entrega": d.delivery_date ? format(new Date(d.delivery_date), "dd/MM/yyyy") : "",
    "EPI": d.ppe?.name || "",
    "Nº C.A.": d.ppe?.ca_number || "",
    "Quantidade": d.quantity || 1,
    "Motivo": d.reason || "",
    "Status": d.returned_at ? "Devolvido" : "Em Uso",
    "Data Devolução": d.returned_at ? format(new Date(d.returned_at), "dd/MM/yyyy") : "—",
    "Custo (R$)": d.ppe?.cost || 0,
  }))

  const ws = XLSX.utils.json_to_sheet(rows, { origin: "A5" })
  addHeaderToSheet(ws, `Prontuário Individual: ${employeeName}`)
  styleWorksheet(ws, 8)
  XLSX.utils.book_append_sheet(wb, ws, "Prontuário")

  XLSX.writeFile(wb, `Prontuario_${employeeName.replace(/\s+/g, '_')}.xlsx`)
}

// ─────────────────────────────────────────────
// Style helper (auto column widths)
// ─────────────────────────────────────────────

function styleWorksheet(ws: XLSX.WorkSheet, colCount: number) {
  const colWidths = []
  for (let i = 0; i < colCount; i++) {
    colWidths.push({ wch: 22 }) // Set a comfortable width for all columns
  }
  // Make the first column (usually EPI name or Colaborador) wider
  if (colWidths.length > 1) {
    colWidths[1] = { wch: 35 }
  }
  ws["!cols"] = colWidths
}
