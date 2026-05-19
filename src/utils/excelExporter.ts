import ExcelJS from "exceljs"
import { format } from "date-fns"
import { COMPANY_CONFIG } from "@/config/company"
import { DeliveryWithRelations, PPE } from "@/types/database"
import { formatDateOnly, formatDeliveryDate } from "@/lib/dateOnly"

type ExcelValue = string | number | null
type ExcelRow = Record<string, ExcelValue>

function addReportSheet(workbook: ExcelJS.Workbook, sheetName: string, title: string, rows: ExcelRow[]) {
  const worksheet = workbook.addWorksheet(sheetName)
  const headers = Object.keys(rows[0] || {})

  worksheet.addRow([`${COMPANY_CONFIG.name.toUpperCase()} - ${COMPANY_CONFIG.systemName.toUpperCase()}`])
  worksheet.addRow([`Relatorio: ${title}`])
  worksheet.addRow([`Exportado em: ${format(new Date(), "dd/MM/yyyy HH:mm")} | Compliance NR-06`])
  worksheet.addRow([])
  worksheet.addRow(headers)

  rows.forEach((row) => {
    worksheet.addRow(headers.map((header) => row[header] ?? ""))
  })

  worksheet.getRow(1).font = { bold: true, size: 14 }
  worksheet.getRow(2).font = { bold: true }
  worksheet.getRow(5).font = { bold: true }
  worksheet.getRow(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } }

  headers.forEach((header, index) => {
    worksheet.getColumn(index + 1).width = header.toLowerCase().includes("colaborador") ? 35 : 22
  })
}

async function saveWorkbook(workbook: ExcelJS.Workbook, fileName: string) {
  if (typeof window === "undefined") return

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

export function exportDeliveriesToExcel(deliveries: DeliveryWithRelations[]) {
  const workbook = new ExcelJS.Workbook()

  const rows = deliveries.map((delivery) => ({
    "Data Entrega": formatDeliveryDate(delivery.delivery_date),
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

  addReportSheet(workbook, "Entregas", "Historico Geral de Entregas", rows)

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

  addReportSheet(workbook, "Resumo por EPI", "Resumo por EPI", summaryRows)

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

  addReportSheet(workbook, "Resumo Canteiros", "Resumo por Canteiro", workplaceRows)

  void saveWorkbook(workbook, `Relatorio_EPIs_${COMPANY_CONFIG.shortName}_${format(new Date(), "yyyy-MM-dd")}.xlsx`)
}

export function exportEmployeeToExcel(
  employeeName: string,
  deliveries: DeliveryWithRelations[]
) {
  const workbook = new ExcelJS.Workbook()

  const rows = deliveries.map((delivery) => ({
    "Data Entrega": formatDeliveryDate(delivery.delivery_date),
    EPI: delivery.ppe?.name || "",
    "No. C.A.": delivery.ppe?.ca_number || "",
    Quantidade: delivery.quantity || 1,
    Motivo: delivery.reason || "",
    Status: delivery.returned_at ? "Devolvido" : "Em Uso",
    "Data Devolucao": delivery.returned_at ? format(new Date(delivery.returned_at), "dd/MM/yyyy") : "-",
    "Custo (R$)": delivery.ppe?.cost || 0,
  }))

  addReportSheet(workbook, "Prontuario", `Prontuario Individual: ${employeeName}`, rows)

  void saveWorkbook(workbook, `Prontuario_${employeeName.replace(/\s+/g, "_")}.xlsx`)
}

export function exportInventoryStockToExcel(ppes: PPE[], filterLabel = "Estoque atual") {
  const workbook = new ExcelJS.Workbook()
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

  const rows = ppes.map((ppe) => {
    const stock = Number(ppe.current_stock || 0)
    const cost = Number(ppe.cost || 0)

    return {
      EPI: ppe.name,
      "No. C.A.": ppe.ca_number || "N/A",
      "Validade C.A.": formatDateOnly(ppe.ca_expiry_date),
      Fabricante: ppe.manufacturer || "",
      Saldo: stock,
      Status: stock <= 5 ? "Estoque baixo" : "OK",
      "Custo Unitario": currency.format(cost),
      "Valor em Estoque": currency.format(stock * cost),
    }
  })

  addReportSheet(workbook, "Estoque", `Relatorio de Estoque - ${filterLabel}`, rows)

  const summaryRows = [
    {
      Indicador: "Itens listados",
      Valor: ppes.length,
    },
    {
      Indicador: "Saldo total",
      Valor: ppes.reduce((acc, ppe) => acc + Number(ppe.current_stock || 0), 0),
    },
    {
      Indicador: "Itens com estoque baixo",
      Valor: ppes.filter((ppe) => Number(ppe.current_stock || 0) <= 5).length,
    },
    {
      Indicador: "Valor estimado",
      Valor: currency.format(ppes.reduce((acc, ppe) => acc + Number(ppe.current_stock || 0) * Number(ppe.cost || 0), 0)),
    },
  ]

  addReportSheet(workbook, "Resumo", "Resumo do Estoque", summaryRows)
  void saveWorkbook(workbook, `Relatorio_Estoque_${COMPANY_CONFIG.shortName}_${format(new Date(), "yyyy-MM-dd")}.xlsx`)
}
