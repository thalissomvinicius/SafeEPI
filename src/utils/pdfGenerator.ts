import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { COMPANY_CONFIG } from "@/config/company"
import QRCode from "qrcode"
import { DeliveryWithRelations } from "@/types/database"

/**
 * PDF Generator Utility for Antares EPI
 * Version: 1.1.2 - Fixes layout and colors
 */

const [r, g, b] = COMPANY_CONFIG.primaryColorRgb

// ─────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────

function addPageHeader(doc: jsPDF, title: string, subtitle: string) {
  const pageWidth = doc.internal.pageSize.getWidth()

  // Background bar
  doc.setFillColor(r, g, b)
  doc.rect(0, 0, pageWidth, 38, "F")

  // White accent line
  doc.setFillColor(r + 30, g + 30, b + 30)
  doc.rect(0, 34, pageWidth, 4, "F")

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.setFont("helvetica", "bold")
  doc.text(COMPANY_CONFIG.name.toUpperCase(), 14, 13)

  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.text(title, pageWidth / 2, 22, { align: "center" })

  doc.setFontSize(8)
  doc.setFont("helvetica", "normal")
  doc.text(subtitle, pageWidth / 2, 30, { align: "center" })

  doc.setFontSize(7)
  doc.text(format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR }), pageWidth - 14, 13, { align: "right" })

  doc.setTextColor(30, 41, 59)
}

function addPageFooter(doc: jsPDF, hash?: string, ip?: string) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  doc.setFillColor(248, 250, 252)
  doc.rect(0, pageHeight - 16, pageWidth, 16, "F")

  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(14, pageHeight - 16, pageWidth - 14, pageHeight - 16)

  doc.setFontSize(6)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(100, 116, 139)

  const left = `${COMPANY_CONFIG.systemName} • NR-06 Compliance • Identidade Digital Verificada`
  const right = hash ? `Hash: ${hash} | IP: ${ip || 'N/A'}` : `Emitido em ${format(new Date(), "dd/MM/yyyy")}`
  doc.text(left, 14, pageHeight - 6)
  doc.text(right, pageWidth - 14, pageHeight - 6, { align: "right" })
}

function infoRow(doc: jsPDF, label: string, value: string, x: number, y: number) {
  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139)
  doc.text(label.toUpperCase(), x, y)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(30, 41, 59)
  doc.text(value || "—", x, y + 5)
}

// ─────────────────────────────────────────────
// 1. FICHA DE ENTREGA (NR-06) - MODERN LAYOUT
// ─────────────────────────────────────────────

export interface DeliveryPDFData {
  employeeName: string
  employeeCpf: string
  employeeRole: string
  workplaceName: string
  ppeName?: string
  ppeCaNumber?: string
  ppeCaExpiry?: string
  quantity?: number
  reason?: string
  items?: { ppeName: string; ppeCaNumber: string; caExpiry?: string; quantity: number; reason: string }[]
  authMethod: 'manual' | 'facial'
  signatureBase64: string
  photoBase64?: string
  ipAddress?: string
  location?: string
  validationHash?: string
  deliveryDate?: string
}

export async function generateDeliveryPDF(data: DeliveryPDFData): Promise<Blob> {
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const hash = data.validationHash || Math.random().toString(36).substring(2, 12).toUpperCase()

  const pdfItems = data.items && data.items.length > 0
    ? data.items
    : [{ ppeName: data.ppeName || "", ppeCaNumber: data.ppeCaNumber || "", caExpiry: data.ppeCaExpiry, quantity: data.quantity || 0, reason: data.reason || "" }]

  doc.setFillColor(r, g, b)
  doc.rect(0, 0, pageWidth, 40, "F")
  
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.text(COMPANY_CONFIG.name.toUpperCase(), 14, 15)
  
  doc.setFontSize(18)
  doc.text("FICHA DE ENTREGA DE EPI", pageWidth / 2, 22, { align: "center" })
  
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.text("NR-06 | Certificado de Uso Individual", pageWidth / 2, 30, { align: "center" })
  
  doc.setFontSize(7)
  const today = data.deliveryDate ? format(new Date(data.deliveryDate), "dd/MM/yyyy", { locale: ptBR }) : format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })
  doc.text(today, pageWidth - 14, 15, { align: "right" })

  let currentY = 50
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(230, 230, 230)
  doc.roundedRect(14, currentY, pageWidth - 28, 35, 3, 3, "S")
  
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.setTextColor(r, g, b)
  doc.text(data.employeeName.toUpperCase(), 20, currentY + 10)
  
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  
  doc.text("CPF", 20, currentY + 18)
  doc.setTextColor(30, 41, 59)
  doc.setFont("helvetica", "bold")
  doc.text(data.employeeCpf, 20, currentY + 23)
  
  doc.setTextColor(100, 116, 139)
  doc.setFont("helvetica", "normal")
  doc.text("CARGO / FUNÇÃO", pageWidth / 2, currentY + 18)
  doc.setTextColor(30, 41, 59)
  doc.setFont("helvetica", "bold")
  doc.text(data.employeeRole || "Não Informado", pageWidth / 2, currentY + 23)
  
  doc.setTextColor(100, 116, 139)
  doc.setFont("helvetica", "normal")
  doc.text("UNIDADE / CANTEIRO", pageWidth - 20, currentY + 18, { align: "right" })
  doc.setTextColor(30, 41, 59)
  doc.setFont("helvetica", "bold")
  doc.text(data.workplaceName || "Sede", pageWidth - 20, currentY + 23, { align: "right" })

  currentY += 45
  autoTable(doc, {
    startY: currentY,
    head: [["Equipamento (EPI)", "Nº CA", "Venc. CA", "Qtd", "Motivo", "Data Entrega"]],
    body: pdfItems.map(item => [
      item.ppeName,
      item.ppeCaNumber,
      item.caExpiry ? format(new Date(item.caExpiry), "dd/MM/yyyy") : "—",
      String(item.quantity),
      item.reason,
      data.deliveryDate ? format(new Date(data.deliveryDate), "dd/MM/yyyy") : format(new Date(), "dd/MM/yyyy")
    ]),
    styles: { fontSize: 8.5, cellPadding: 4, font: "helvetica" },
    headStyles: { fillColor: [245, 245, 245], textColor: [71, 85, 105], fontStyle: "bold" },
    margin: { left: 14, right: 14 },
    theme: 'grid'
  })

  // @ts-expect-error - jsPDF-autotable adds lastAutoTable to doc
  currentY = doc.lastAutoTable.finalY + 15
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(14, currentY, pageWidth - 28, 25, 2, 2, "S")
  
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(r, g, b)
  doc.text("TERMO DE RESPONSABILIDADE", 20, currentY + 7)
  
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7.5)
  doc.setTextColor(71, 85, 105)
  const termText = "Declaro ter recebido o(s) EPI(s) listado(s) acima em perfeito estado, comprometendo-me a utilizá-lo(s) para a finalidade a que se destina(m), responsabilizando-me pela sua guarda e conservação conforme NR-06 do MTE."
  const splitTerm = doc.splitTextToSize(termText, pageWidth - 36)
  doc.text(splitTerm, 18, currentY + 13, { align: "left" })

  currentY += 35
  
  let isPhoto = data.authMethod === 'facial'
  let imgRatio = 1
  
  if (data.signatureBase64) {
    try {
      const imgProps = doc.getImageProperties(data.signatureBase64)
      imgRatio = imgProps.width / imgProps.height
      if (imgRatio <= 1.5) isPhoto = true
      if (imgRatio > 2.5) isPhoto = false
    } catch { /* keep declared method */ }
  }

  if (isPhoto && data.signatureBase64) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.setTextColor(71, 85, 105)
    doc.text("AUTENTICAÇÃO BIOMÉTRICA", pageWidth / 2, currentY, { align: "center" })
    
    const containerSize = 50
    const containerX = pageWidth / 2 - containerSize / 2
    doc.setDrawColor(226, 232, 240)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(containerX - 2, currentY + 5, containerSize + 4, containerSize + 4, 3, 3, "FD")
    
    try {
      let drawW: number, drawH: number
      if (imgRatio >= 1) {
        drawW = containerSize
        drawH = containerSize / imgRatio
      } else {
        drawH = containerSize
        drawW = containerSize * imgRatio
      }
      const drawX = containerX + (containerSize - drawW) / 2
      const drawY = currentY + 7 + (containerSize - drawH) / 2
      doc.addImage(data.signatureBase64, 'JPEG', drawX, drawY, drawW, drawH)
    } catch (e) {
      console.error("Error adding photo to PDF", e)
    }
    
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(30, 41, 59)
    doc.text(data.employeeName.toUpperCase(), pageWidth / 2, currentY + containerSize + 16, { align: "center" })
    
    doc.setFontSize(7)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(148, 163, 184)
    doc.text("Identidade Validada por IA (face-api.js / TensorFlow)", pageWidth / 2, currentY + containerSize + 21, { align: "center" })
    
    currentY += containerSize + 30
  } else {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.setTextColor(71, 85, 105)
    doc.text("ASSINATURA DO COLABORADOR", pageWidth / 2, currentY, { align: "center" })
    
    const sigBoxW = 100
    const sigBoxH = 30
    const sigBoxX = (pageWidth - sigBoxW) / 2
    
    doc.setDrawColor(226, 232, 240)
    doc.setFillColor(252, 252, 252)
    doc.roundedRect(sigBoxX, currentY + 4, sigBoxW, sigBoxH, 2, 2, "FD")
    
    try {
      const imgProps = doc.getImageProperties(data.signatureBase64)
      const sigRatio = imgProps.width / imgProps.height
      let drawW = sigBoxW - 8
      let drawH = drawW / sigRatio
      if (drawH > sigBoxH - 6) {
        drawH = sigBoxH - 6
        drawW = drawH * sigRatio
      }
      const drawX = sigBoxX + (sigBoxW - drawW) / 2
      const drawY = currentY + 4 + (sigBoxH - drawH) / 2
      doc.addImage(data.signatureBase64, 'PNG', drawX, drawY, drawW, drawH)
    } catch {}
    
    doc.setDrawColor(200, 200, 200)
    doc.line(sigBoxX + 10, currentY + sigBoxH + 6, sigBoxX + sigBoxW - 10, currentY + sigBoxH + 6)
    
    doc.setFontSize(8)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(30, 41, 59)
    doc.text(data.employeeName.toUpperCase(), pageWidth / 2, currentY + sigBoxH + 12, { align: "center" })
    
    currentY += sigBoxH + 22
  }

  doc.setFillColor(252, 252, 252)
  doc.setDrawColor(240, 240, 240)
  doc.roundedRect(14, currentY, pageWidth - 28, 35, 3, 3, "FD")
  
  const metaX = 20
  doc.setFontSize(7)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(148, 163, 184)
  doc.text("HASH DE VALIDAÇÃO", metaX, currentY + 10)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(71, 85, 105)
  doc.text(hash, metaX, currentY + 14)
  
  doc.setFont("helvetica", "normal")
  doc.setTextColor(148, 163, 184)
  doc.text("IP DO TERMINAL", metaX, currentY + 21)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(71, 85, 105)
  doc.text(data.ipAddress || "Remoto", metaX, currentY + 25)
  
  doc.setFont("helvetica", "normal")
  doc.setTextColor(148, 163, 184)
  doc.text("GEOLOCALIZAÇÃO", metaX, currentY + 31)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(71, 85, 105)
  doc.text(data.location || "Coordenadas não capturadas", metaX, currentY + 35)

  try {
    const qrText = `${COMPANY_CONFIG.systemName} | Valid: ${hash} | Date: ${today}`
    const qrDataUrl = await QRCode.toDataURL(qrText, { width: 200, margin: 1 })
    doc.addImage(qrDataUrl, 'PNG', pageWidth - 45, currentY + 5, 25, 25)
    doc.setFontSize(6)
    doc.setTextColor(200, 200, 200)
    doc.text("Scan to Verify", pageWidth - 32, currentY + 33, { align: "center" })
  } catch {}

  currentY += 45
  doc.setDrawColor(230, 230, 230)
  doc.setLineWidth(0.3)
  doc.line(14, currentY, pageWidth - 14, currentY)
  doc.setFontSize(6.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(148, 163, 184)
  const footerText = `${COMPANY_CONFIG.systemName} Digital • NR-06 Compliance • Documento gerado automaticamente para fins de auditoria.`
  doc.text(footerText, pageWidth / 2, currentY + 6, { align: "center" })

  return doc.output("blob")
}

// ─────────────────────────────────────────────
// 2. RECIBO DE BAIXA / SUBSTITUIÇÃO
// ─────────────────────────────────────────────

export interface ReturnPDFData {
  employeeName: string
  employeeCpf: string
  workplaceName: string
  returnedItemName: string
  returnMotive: string
  newItemName?: string
  newItemCa?: string
  authMethod: 'manual' | 'facial'
  signatureBase64: string
}

export async function generateReturnPDF(data: ReturnPDFData): Promise<Blob> {
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const hash = Math.random().toString(36).substring(2, 12).toUpperCase()

  addPageHeader(doc, "RECIBO DE BAIXA / SUBSTITUIÇÃO E.P.I.", "Registro de Devolução e Troca — NR-06")

  const boxY = 46
  infoRow(doc, "Colaborador", data.employeeName, 14, boxY)
  infoRow(doc, "CPF", data.employeeCpf, 14, boxY + 12)
  infoRow(doc, "Unidade / Sede", data.workplaceName, pageWidth / 2, boxY + 12)

  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(14, boxY + 20, pageWidth - 14, boxY + 20)

  const retY = boxY + 28
  doc.setFillColor(254, 242, 242)
  doc.setDrawColor(252, 165, 165)
  doc.roundedRect(14, retY, (pageWidth - 28) / 2 - 4, 26, 3, 3, "FD")
  doc.setFontSize(8)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(r, g, b)
  doc.text("ITEM DEVOLVIDO / BAIXADO", 18, retY + 8)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(30, 41, 59)
  doc.text(data.returnedItemName, 18, retY + 16)
  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139)
  doc.text(`Motivo: ${data.returnMotive}`, 18, retY + 23)

  if (data.newItemName) {
    doc.setFillColor(240, 253, 244)
    doc.setDrawColor(134, 239, 172)
    const halfW = (pageWidth - 28) / 2
    doc.roundedRect(14 + halfW + 4, retY, halfW - 4, 26, 3, 3, "FD")
    doc.setFontSize(8)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(21, 128, 61)
    doc.text("NOVO EPI ENTREGUE", 18 + halfW + 4, retY + 8)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(30, 41, 59)
    doc.text(data.newItemName, 18 + halfW + 4, retY + 16)
    if (data.newItemCa) {
      doc.setFontSize(7.5)
      doc.setTextColor(100, 116, 139)
      doc.text(`CA: ${data.newItemCa}`, 18 + halfW + 4, retY + 23)
    }
  }

  const termY = retY + 34
  const term = data.newItemName
    ? "Confirmo a devolução do item antigo e o recebimento do novo equipamento listado acima em perfeitas condições de uso."
    : "Confirmo a devolução do item acima, encerrando minha responsabilidade sobre o mesmo. Estou ciente das implicações legais conforme NR-06."
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.roundedRect(14, termY, pageWidth - 28, 16, 3, 3, "FD")
  doc.setFont("helvetica", "italic")
  doc.setFontSize(7.5)
  doc.setTextColor(71, 85, 105)
  doc.text(`"${term}"`, pageWidth / 2, termY + 10, { align: "center" })

  const sigY = termY + 24
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.roundedRect(14, sigY, pageWidth - 28, 50, 3, 3, "FD")
  try {
    if (data.authMethod === 'facial') {
      doc.addImage(data.signatureBase64, 'JPEG', (pageWidth - 40) / 2, sigY + 3, 40, 40)
    } else {
      doc.addImage(data.signatureBase64, 'PNG', (pageWidth - 80) / 2, sigY + 5, 80, 30)
    }
  } catch { /* */ }
  doc.setLineWidth(0.5)
  doc.line(40, sigY + 42, pageWidth - 40, sigY + 42)
  doc.setFontSize(7.5)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(100, 116, 139)
  doc.text(data.employeeName.toUpperCase(), pageWidth / 2, sigY + 47, { align: "center" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(6.5)
  doc.text(`${data.authMethod === 'facial' ? 'Biometria Facial' : 'Assinatura Manual'} — ${format(new Date(), "dd/MM/yyyy HH:mm")}`, pageWidth / 2, sigY + 52, { align: "center" })

  addPageFooter(doc, hash)
  return doc.output("blob")
}

// ─────────────────────────────────────────────
// 3. FICHA NR-06 (Prontuário do Colaborador)
// ─────────────────────────────────────────────

export interface NR06PDFData {
  employeeName: string
  employeeCpf: string
  employeeRole: string
  employeeDepartment: string
  workplaceName: string
  admissionDate: string
  items: {
    deliveryDate: string
    ppeName: string
    caNr: string
    quantity: number
    reason: string
    returnedAt?: string | null
    isExpired: boolean
    signatureUrl?: string | null
    signatureBase64?: string
  }[]
  tstSigner?: {
    name: string
    role: string
    signatureBase64: string
    authMethod: 'manual' | 'facial'
  }
}

export async function generateNR06PDF(data: NR06PDFData): Promise<Blob> {
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  addPageHeader(doc, "FICHA DE CONTROLE DE EPI — NR-06", "Documento de Prontuário Individual do Colaborador")

  const boxY = 46
  const col = (pageWidth - 28) / 3

  const fields = [
    { label: "Colaborador", value: data.employeeName },
    { label: "CPF", value: data.employeeCpf },
    { label: "Cargo / Função", value: data.employeeRole },
    { label: "Setor / Depto.", value: data.employeeDepartment },
    { label: "Canteiro / Unidade", value: data.workplaceName },
    { label: "Data de Admissão", value: data.admissionDate },
  ]

  fields.forEach((f, i) => {
    const x = 14 + (i % 3) * col
    const y = boxY + Math.floor(i / 3) * 17
    infoRow(doc, f.label, f.value, x, y)
  })

  const itemsWithSigs = await Promise.all(
    data.items.map(async (item) => {
      if (item.signatureBase64) return item
      if (item.signatureUrl) {
        try {
          const res = await fetch(item.signatureUrl)
          const blob = await res.blob()
          const b64 = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
          return { ...item, signatureBase64: b64 }
        } catch { /* fallback */ }
      }
      return item
    })
  )

  const tableY = boxY + 38
  autoTable(doc, {
    startY: tableY,
    head: [["Data", "EPI", "Nº C.A.", "Qtd", "Motivo", "Status", "Devolução", "Assinatura"]],
    body: itemsWithSigs.map(item => [
      item.deliveryDate,
      item.ppeName,
      item.caNr,
      item.quantity,
      item.reason,
      item.returnedAt ? "Devolvido" : item.isExpired ? "⚠ Troca Pendente" : "Em uso",
      item.returnedAt ? format(new Date(item.returnedAt), "dd/MM/yyyy") : "—",
      "",
    ]),
    styles: {
      fontSize: 7,
      cellPadding: { top: 6, right: 3, bottom: 6, left: 3 },
      font: "helvetica",
      textColor: [30, 41, 59],
      minCellHeight: 12,
    },
    headStyles: {
      fillColor: [r, g, b],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 6.5,
      halign: "center",
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 18 },
      2: { halign: "center", cellWidth: 14 },
      3: { halign: "center", cellWidth: 12 },
      5: { halign: "center" },
      6: { halign: "center", cellWidth: 18 },
      7: { cellWidth: 32, halign: "center" },
    },
    willDrawCell: (hookData) => {
      if (hookData.section === 'body' && hookData.column.index === 5) {
        const val = String(hookData.cell.raw)
        if (val.includes("Troca")) hookData.cell.styles.textColor = [r, g, b]
        if (val === "Devolvido") hookData.cell.styles.textColor = [21, 128, 61]
      }
    },
    didDrawCell: (hookData) => {
      if (hookData.section === 'body' && hookData.column.index === 7) {
        const rowIndex = hookData.row.index
        const item = itemsWithSigs[rowIndex]
        if (!item?.signatureBase64) return

        const cell = hookData.cell
        const maxW = cell.width - 4
        const maxH = cell.height - 4
        const x = cell.x + 2
        const y = cell.y + 2

        try {
          const imgProps = doc.getImageProperties(item.signatureBase64)
          const ratio = imgProps.width / imgProps.height
          let drawW = maxW, drawH = maxW / ratio
          if (drawH > maxH) { drawH = maxH; drawW = maxH * ratio }
          const dx = x + (maxW - drawW) / 2
          const dy = y + (maxH - drawH) / 2
          const fmt = item.signatureBase64.startsWith('data:image/png') ? 'PNG' : 'JPEG'
          doc.addImage(item.signatureBase64, fmt, dx, dy, drawW, drawH)
        } catch { /* skip */ }
      }
    },
    margin: { left: 14, right: 14 },
  })

  // @ts-expect-error - jsPDF-autotable adds lastAutoTable to doc
  let finalY = doc.lastAutoTable?.finalY || 200
  finalY += 12

  if (data.tstSigner) {
    const tst = data.tstSigner
    const blockWidth = 88
    const blockX = (pageWidth - blockWidth) / 2
    const blockY = finalY
    const contentX = blockX + 16
    const contentWidth = blockWidth - 32
    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.8)
    doc.roundedRect(blockX, blockY, blockWidth, 50, 4, 4)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.setTextColor(71, 85, 105)
    doc.text("ASSINATURA DO RESPONSÁVEL TÉCNICO", pageWidth / 2, blockY + 7, { align: "center" })

    try {
      const imgProps = doc.getImageProperties(tst.signatureBase64)
      const ratio = imgProps.width / imgProps.height
      const isPhoto = ratio <= 1.5
      const drawH = isPhoto ? 20 : 12
      let drawW = drawH * ratio
      if (drawW > contentWidth) {
        drawW = contentWidth
      }
      const sigX = blockX + (blockWidth - drawW) / 2
      const sigY = blockY + 12
      const fmt = tst.signatureBase64.startsWith('data:image/png') ? 'PNG' : 'JPEG'
      doc.addImage(tst.signatureBase64, fmt, sigX, sigY, drawW, drawH)
    } catch { /* skip */ }

    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.3)
    doc.line(contentX, blockY + 34, contentX + contentWidth, blockY + 34)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(30, 41, 59)
    doc.text(tst.name.toUpperCase(), contentX, blockY + 40)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(102, 102, 102)
    doc.text(tst.role, contentX, blockY + 45)

    finalY += 56
  }

  const emitDate = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
  const footerY = pageHeight - 24
  doc.setFillColor(248, 250, 252)
  doc.rect(0, footerY - 8, pageWidth, 20, "F")
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(14, footerY - 4, pageWidth - 14, footerY - 4)

  doc.setFontSize(7)
  doc.setFont("helvetica", "italic")
  doc.setTextColor(100, 116, 139)
  doc.text(`Documento emitido em ${emitDate} pelo ${COMPANY_CONFIG.systemName}.`, 14, footerY + 2)
  doc.text(`${COMPANY_CONFIG.systemName} • NR-06 Compliance • Identidade Digital Verificada`, 14, footerY + 6)

  return doc.output("blob")
}

// ─────────────────────────────────────────────
// 4. RELATÓRIO GERAL (ANALYTICS)
// ─────────────────────────────────────────────

export interface ReportPDFData {
  stats: { label: string; value: string; change: string }[]
  deliveries: DeliveryWithRelations[]
  periodTitle?: string
}

export function generateGeneralReportPDF(data: ReportPDFData): Blob {
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()

  const subtitle = data.periodTitle ? `Métricas Globais e Rastreabilidade • ${data.periodTitle}` : "Métricas Globais e Rastreabilidade (NR-06)"
  addPageHeader(doc, "RELATÓRIO DE CONFORMIDADE E CUSTOS", subtitle)

  let currentY = 50
  
  doc.setFontSize(10)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(r, g, b)
  doc.text("MÉTRICAS GLOBAIS", 14, currentY)
  currentY += 8

  const cardWidth = (pageWidth - 28 - (3 * 5)) / 4
  
  data.stats.forEach((stat, i) => {
    const x = 14 + (i * (cardWidth + 5))
    doc.setDrawColor(226, 232, 240)
    doc.setFillColor(250, 250, 250)
    doc.roundedRect(x, currentY, cardWidth, 22, 2, 2, "FD")
    
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(stat.label.substring(0, 20), x + 3, currentY + 7)
    
    doc.setFontSize(10)
    doc.setTextColor(30, 41, 59)
    doc.text(stat.value, x + 3, currentY + 14)
    
    doc.setFontSize(6)
    doc.setTextColor(r, g, b)
    doc.text(stat.change, x + 3, currentY + 19)
  })

  currentY += 35

  doc.setFontSize(10)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(r, g, b)
  doc.text("HISTÓRICO RECENTE DE TRANSAÇÕES", 14, currentY)
  currentY += 5

  const recentDeliveries = data.deliveries.slice(0, 50)

  autoTable(doc, {
    startY: currentY,
    head: [["Data", "Colaborador", "EPI (C.A.)", "Qtd", "Local"]],
    body: recentDeliveries.map(d => [
      format(new Date(d.delivery_date), "dd/MM/yyyy HH:mm"),
      d.employee?.full_name || 'N/A',
      `${d.ppe?.name || 'N/A'} (${d.ppe?.ca_number || 'N/A'})`,
      String(d.quantity),
      d.workplace?.name || 'Sede'
    ]),
    styles: { fontSize: 7, cellPadding: 3, font: "helvetica" },
    headStyles: { fillColor: [r, g, b], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
    theme: 'grid'
  })

  const finalY = (doc as any).lastAutoTable?.finalY || 200
  const emitDate = format(new Date(), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })
  doc.setFontSize(7)
  doc.setFont("helvetica", "italic")
  doc.setTextColor(100, 116, 139)
  doc.text(`Relatório gerado em ${emitDate} pelo sistema.`, 14, finalY + 10)

  addPageFooter(doc)
  return doc.output("blob")
}

// ─────────────────────────────────────────────
// 5. CERTIFICADO DE TREINAMENTO
// ─────────────────────────────────────────────

export interface TrainingCertificateData {
  employeeName: string
  employeeCpf: string
  trainingName: string
  completionDate: string
  expiryDate: string
  instructorName?: string
  instructorRole?: string
  signatureBase64?: string
  programContent?: string[]
  validationCode?: string
}

export async function generateTrainingCertificate(data: TrainingCertificateData): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth() // 297
  const pageHeight = doc.internal.pageSize.getHeight() // 210
  const centerX = pageWidth / 2

  const drawBorders = () => {
    // Outer border: 6px solid #8B0000 -> 6px is ~2.1mm
    doc.setDrawColor(139, 0, 0)
    doc.setLineWidth(2.1)
    doc.rect(10, 10, pageWidth - 20, pageHeight - 20)
    // Inner border: 1.5px solid #8B0000 -> 1.5px is ~0.5mm
    doc.setLineWidth(0.5)
    doc.rect(13.5, 13.5, pageWidth - 27, pageHeight - 27)
  }

  // --- PAGE 1: FRENTE ---
  // Background changed to pure white so the logo doesn't show a white bounding box
  doc.setFillColor(255, 255, 255)
  doc.rect(0, 0, pageWidth, pageHeight, "F")
  
  drawBorders()
  
  // Header: Logo on left, title in center, photo on right
  let logoBase64: string | null = null;
  try {
    const logoRes = await fetch('/logo.png');
    const logoBlob = await logoRes.blob();
    logoBase64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(logoBlob);
    });
  } catch (e) {
    console.error("Could not load logo.png", e);
  }

  const marginX = 25; // 30px padding from border ~ 10mm + 13.5mm = ~23.5mm

  if (logoBase64) {
    try {
      // 90px height -> ~31.5mm
      const imgHeight = 31.5;
      const imgWidth = 42; // approx 4:3
      doc.addImage(logoBase64, "PNG", marginX, 20, imgWidth, imgHeight);
    } catch { }
  }

  doc.setFont("times", "bold")
  doc.setFontSize(28)
  doc.setTextColor(26, 26, 46) // #1a1a2e
  doc.text("CERTIFICADO DE CONCLUSÃO", centerX, 40, { align: "center" })

  // Decorative line below title (220px ~ 77mm)
  doc.setDrawColor(139, 0, 0)
  doc.setLineWidth(0.7)
  const lineW = 77
  doc.line(centerX - lineW/2, 45, centerX + lineW/2, 45)

  // Photo on right (60x75px ~ 21x26mm oval)
  const photoW = 21;
  const photoH = 26;
  const photoX = pageWidth - marginX - photoW;
  const photoY = 20;
  
  doc.setDrawColor(139, 0, 0)
  doc.setLineWidth(0.7)
  if (data.signatureBase64 && data.signatureBase64.startsWith('data:image/jpeg')) {
    doc.roundedRect(photoX, photoY, photoW, photoH, 3, 3, "S")
    doc.addImage(data.signatureBase64, "JPEG", photoX+1, photoY+1, photoW-2, photoH-2)
  } else {
    doc.ellipse(photoX + photoW/2, photoY + photoH/2, photoW/2, photoH/2, "S")
  }
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(150, 150, 150)
  doc.text("Resp. Técnico", photoX + photoW/2, photoY + photoH + 5, { align: "center" })

  // Corpo Central
  doc.setFont("helvetica", "italic")
  doc.setFontSize(12)
  doc.setTextColor(85, 85, 85) // #555555
  doc.text("Certificamos para os devidos fins que", centerX, 70, { align: "center" })

  doc.setFont("times", "bold")
  doc.setFontSize(24)
  doc.setTextColor(139, 0, 0) // #8B0000
  doc.text(data.employeeName.toUpperCase(), centerX, 85, { align: "center" })

  doc.setFont("helvetica", "normal")
  doc.setFontSize(11)
  doc.setTextColor(68, 68, 68) // #444444
  doc.text(`Portador(a) do CPF: ${data.employeeCpf}`, centerX, 95, { align: "center" })

  // Divisor ornamental (drawn with lines instead of text to avoid weird spacing)
  doc.setDrawColor(139, 0, 0)
  doc.setLineWidth(0.5)
  doc.line(centerX - 12, 103, centerX - 3, 103)
  doc.setFillColor(139, 0, 0)
  doc.circle(centerX, 103, 1, "F")
  doc.line(centerX + 3, 103, centerX + 12, 103)

  doc.setFont("helvetica", "italic")
  doc.setFontSize(12)
  doc.setTextColor(85, 85, 85)
  doc.text("concluiu com êxito o treinamento de", centerX, 115, { align: "center" })

  doc.setFont("helvetica", "bold")
  doc.setFontSize(20)
  doc.setTextColor(26, 26, 46)
  doc.text(data.trainingName.toUpperCase(), centerX, 127, { align: "center" })

  const getTrainingWorkload = (name: string): number => {
    const n = name.toLowerCase();
    if (n.includes('nr-10') || n.includes('nr 10')) return 40;
    if (n.includes('nr-33') && n.includes('supervisor')) return 40;
    if (n.includes('nr-33') || n.includes('nr 33')) return 16;
    if (n.includes('nr-35') || n.includes('nr 35')) return 8;
    if (n.includes('nr-12') || n.includes('nr 12')) return 16;
    if (n.includes('nr-20') || n.includes('nr 20')) return 16;
    if (n.includes('nr-05') || n.includes('nr 05') || n.includes('cipa')) return 20;
    return 4;
  };
  const workload = getTrainingWorkload(data.trainingName);

  const completionText = format(new Date(data.completionDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
  const validUntilText = format(new Date(data.expiryDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })

  doc.setFont("helvetica", "normal")
  doc.setFontSize(11)
  doc.setTextColor(68, 68, 68)
  doc.text(`Realizado em: ${completionText}  |  Carga Horária: ${workload}h  |  Válido até: ${validUntilText}`, centerX, 137, { align: "center" })

  // Rodapé (3 cols)
  const footerY = 165
  
  const code = data.validationCode || `CERT-${format(new Date(data.completionDate), "yyyy")}-${Math.floor(Math.random()*10000).toString().padStart(4, '0')}`;
  const validationUrl = `https://sesmt.antaresempreendimentos.com.br/validar/${code}`;
  
  // Left: QR Code (70x70px ~ 25x25mm)
  try {
    const qrDataUrl = await QRCode.toDataURL(validationUrl, { width: 150, margin: 1 })
    doc.addImage(qrDataUrl, 'PNG', marginX, footerY, 25, 25)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(119, 119, 119) // #777777
    doc.text(`Autenticação:`, marginX + 12.5, footerY + 28, { align: "center" })
    doc.setFontSize(6)
    doc.text(`${validationUrl.replace('https://', '')}`, marginX + 12.5, footerY + 31, { align: "center" })
  } catch {}

  // Center: Signature
  if (data.instructorName) {
    const sigLineW = 63 // ~180px
    const sigY = footerY + 15
    doc.setDrawColor(139, 0, 0)
    doc.setLineWidth(0.5)
    doc.line(centerX - sigLineW/2, sigY, centerX + sigLineW/2, sigY)

    if (data.signatureBase64 && !data.signatureBase64.startsWith('data:image/jpeg')) {
      try {
        const imgProps = doc.getImageProperties(data.signatureBase64)
        const ratio = imgProps.width / imgProps.height
        let drawH = 15; // ~45px
        let drawW = drawH * ratio;
        if (drawW > sigLineW) {
          drawW = sigLineW;
          drawH = drawW / ratio;
        }
        doc.addImage(data.signatureBase64, "PNG", centerX - drawW/2, sigY - drawH - 1, drawW, drawH)
      } catch {}
    }

    doc.setFont("helvetica", "bold")
    doc.setFontSize(11)
    doc.setTextColor(85, 85, 85)
    doc.text(data.instructorName.toUpperCase(), centerX, sigY + 5, { align: "center" })
    
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.text(data.instructorRole || "Resp. Técnico", centerX, sigY + 10, { align: "center" })
  }

  // Right: Footer text
  const rightX = pageWidth - marginX;
  doc.setFont("helvetica", "italic")
  doc.setFontSize(8)
  doc.setTextColor(136, 136, 136) // #888888
  const emitDate = format(new Date(), "dd/MM/yyyy")
  const emitTime = format(new Date(), "HH:mm")
  doc.text(`Documento emitido digitalmente em ${emitDate} às ${emitTime}`, rightX, footerY + 18, { align: "right" })
  
  doc.setFont("helvetica", "normal")
  doc.text("via Sistema SESMT Digital", rightX, footerY + 22, { align: "right" })
  
  doc.setFont("helvetica", "bold")
  doc.text(`Código: ${code}`, rightX, footerY + 26, { align: "right" })

  // --- PAGE 2: VERSO ---
  doc.addPage()
  drawBorders()

  // Cabeçalho Simplificado
  if (logoBase64) {
    try {
      const imgHeight = 21; // ~60px
      const imgWidth = 28;
      doc.addImage(logoBase64, "PNG", marginX, 20, imgWidth, imgHeight);
    } catch { }
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.setTextColor(26, 26, 46)
  doc.text("CONTEÚDO PROGRAMÁTICO", centerX, 30, { align: "center" })

  doc.setFont("helvetica", "italic")
  doc.setFontSize(14)
  doc.setTextColor(139, 0, 0)
  doc.text(data.trainingName.toUpperCase(), centerX, 38, { align: "center" })

  // Tabela de Conteúdo Programático
  const content = data.programContent && data.programContent.length > 0 
    ? data.programContent 
    : [
        "1. Normas e regulamentos de segurança.",
        "2. Identificação de riscos e perigos.",
        "3. Procedimentos operacionais padrão (POP).",
        "4. Uso correto e guarda de EPIs.",
        "5. Primeiros socorros e ações de emergência."
      ];
    
  const tableData = [];
  for (let i = 0; i < content.length; i += 2) {
    tableData.push([
      content[i] ? `   ${content[i]}` : "",
      content[i+1] ? `   ${content[i+1]}` : ""
    ]);
  }

  autoTable(doc, {
    startY: 50,
    body: tableData,
    theme: 'plain',
    styles: {
      fontSize: 10,
      font: "helvetica",
      textColor: [85, 85, 85],
      cellPadding: 4,
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250] // #fafafa
    },
    columnStyles: {
      0: { cellWidth: (pageWidth - 2 * marginX) / 2 },
      1: { cellWidth: (pageWidth - 2 * marginX) / 2 }
    },
    margin: { left: marginX, right: marginX },
    didDrawCell: (hookData) => {
      if (hookData.section === 'body' && hookData.cell.raw && typeof hookData.cell.raw === 'string' && hookData.cell.raw.trim().length > 0) {
        // Draw small red bullet points
        hookData.doc.setFillColor(139, 0, 0);
        hookData.doc.circle(hookData.cell.x + 4, hookData.cell.y + hookData.cell.height/2, 1.2, "F");
      }
    }
  })

  // Informações Legais (Footer Verso)
  const versoFooterY = pageHeight - 45;
  
  // Draw Box
  doc.setFillColor(245, 245, 245) // #f5f5f5
  doc.rect(marginX, versoFooterY, pageWidth - 2 * marginX - 40, 20, "F")
  
  // Left border of the box
  doc.setDrawColor(139, 0, 0)
  doc.setLineWidth(1.4) // 4px
  doc.line(marginX, versoFooterY, marginX, versoFooterY + 20)

  // Box text
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(85, 85, 85)
  const nrNumberMatch = data.trainingName.match(/NR-?(\d+)/i);
  const nrNumber = nrNumberMatch ? nrNumberMatch[1] : "06";
  const legalText = `Este certificado é válido conforme NR-${nrNumber} e demais legislações vigentes.\nEmitido pelo SESMT da Antares Empreendimentos.`;
  doc.text(legalText, marginX + 5, versoFooterY + 8)

  // Right QR Code
  try {
    const qrDataUrl = await QRCode.toDataURL(validationUrl, { width: 100, margin: 1 })
    doc.addImage(qrDataUrl, 'PNG', pageWidth - marginX - 25, versoFooterY, 25, 25)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(85, 85, 85)
    doc.text("Autenticidade verificável", pageWidth - marginX - 12.5, versoFooterY + 27, { align: "center" })
    doc.text("pelo QR Code", pageWidth - marginX - 12.5, versoFooterY + 30, { align: "center" })
  } catch {}

  return doc.output("blob")
}

// ─────────────────────────────────────────────
// 6. MOVEMENTS REPORT — SIMPLE & PRESENTATION PDF
// ─────────────────────────────────────────────

export interface MovementsStats {
  deliveries: number
  returns: number
  totalItems: number
  uniqueEmployees: number
}

export interface MovementsReportData {
  movements: DeliveryWithRelations[]
  stats: MovementsStats
  period: string
}

function drawCard(doc: jsPDF, x: number, y: number, w: number, h: number, accentColor?: [number, number, number]) {
  doc.setFillColor(226, 232, 240)
  doc.roundedRect(x + 1.5, y + 1.5, w, h, 3, 3, "F")
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x, y, w, h, 3, 3, "F")
  if (accentColor) {
    doc.setFillColor(...accentColor)
    doc.roundedRect(x, y, w, 3, 3, 3, "F")
    doc.setFillColor(255, 255, 255)
    doc.rect(x, y + 2, w, 2, "F")
  }
}

export function generateMovementsSimplePDF(data: MovementsReportData): Blob {
  const doc = new jsPDF({ orientation: "portrait", format: "a4" })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const mx = 14

  doc.setFillColor(r, g, b)
  doc.rect(0, 0, pw, 40, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text(COMPANY_CONFIG.name.toUpperCase(), mx, 12)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.setTextColor(255, 255, 255)
  doc.text("Relatório de Movimentações", mx, 27)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.text(`${data.period}  ·  Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}`, mx, 35)

  const cardY = 48
  const cardW = (pw - mx * 2 - 9) / 4
  const cardH = 28
  const kpis = [
    { label: "Entregas", value: String(data.stats.deliveries), color: [37, 99, 235] as [number, number, number] },
    { label: "Devoluções", value: String(data.stats.returns), color: [217, 119, 6] as [number, number, number] },
    { label: "Itens", value: String(data.stats.totalItems), color: [r, g, b] as [number, number, number] },
    { label: "Pessoas", value: String(data.stats.uniqueEmployees), color: [5, 150, 105] as [number, number, number] },
  ]

  kpis.forEach((kpi, i) => {
    const cx = mx + i * (cardW + 3)
    drawCard(doc, cx, cardY, cardW, cardH, kpi.color)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(18)
    doc.setTextColor(...kpi.color)
    doc.text(kpi.value, cx + cardW / 2, cardY + 16, { align: "center" })
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.label.toUpperCase(), cx + cardW / 2, cardY + 23, { align: "center" })
  })

  autoTable(doc, {
    startY: cardY + cardH + 8,
    head: [["Data", "Colaborador", "EPI / CA", "Qtd", "Tipo", "Unidade"]],
    body: data.movements.map(m => [
      format(new Date(m.delivery_date), "dd/MM/yyyy"),
      m.employee?.full_name || "-",
      `${m.ppe?.name || "-"} (CA: ${m.ppe?.ca_number || "-"})`,
      String(m.quantity),
      m.returned_at ? "DEVOLUÇÃO" : "ENTREGA",
      m.workplace?.name || "Geral"
    ]),
    headStyles: { fillColor: [r, g, b], fontStyle: "bold", fontSize: 8, cellPadding: 4 },
    bodyStyles: { fontSize: 7.5, cellPadding: 3.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 22 },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 24, halign: "center" },
    },
    margin: { left: mx, right: mx },
    theme: "grid",
    styles: { lineColor: [226, 232, 240], lineWidth: 0.3 },
    didParseCell: (hookData) => {
      if (hookData.column.index === 4 && hookData.section === "body") {
        const val = hookData.cell.raw as string
        if (val === "ENTREGA") {
          hookData.cell.styles.textColor = [5, 150, 105]
          hookData.cell.styles.fontStyle = "bold"
        }
        if (val === "DEVOLUÇÃO") {
          hookData.cell.styles.textColor = [217, 119, 6]
          hookData.cell.styles.fontStyle = "bold"
        }
      }
    }
  })

  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(mx, ph - 16, pw - mx, ph - 16)

  doc.setFontSize(7)
  doc.setFont("helvetica", "italic")
  doc.setTextColor(148, 163, 184)
  doc.text(`${COMPANY_CONFIG.name} — ${COMPANY_CONFIG.systemName}`, mx, ph - 10)
  doc.text(`Total: ${data.movements.length} registros`, pw - mx, ph - 10, { align: "right" })

  return doc.output("blob")
}

export function generateMovementsPresentationPDF(data: MovementsReportData): Blob {
  const doc = new jsPDF({ orientation: "landscape", format: "a4" })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()

  doc.setFillColor(r, g, b)
  doc.rect(0, 0, pw, 50, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text(COMPANY_CONFIG.name.toUpperCase(), 18, 14)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(26)
  doc.setTextColor(255, 255, 255)
  doc.text("RELATÓRIO DE MOVIMENTAÇÕES DE EPI", 18, 32)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text(`Período: ${data.period}  ·  Emitido em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}`, 18, 44)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.text(COMPANY_CONFIG.systemName.toUpperCase(), pw - 18, 44, { align: "right" })

  const kpiY = 60
  const kpiW = (pw - 36 - 15) / 4
  const kpiH = 32
  const kpis = [
    { label: "Total de Entregas", value: String(data.stats.deliveries), color: [37, 99, 235] as [number, number, number] },
    { label: "Devoluções", value: String(data.stats.returns), color: [217, 119, 6] as [number, number, number] },
    { label: "Itens Movimentados", value: String(data.stats.totalItems), color: [r, g, b] as [number, number, number] },
    { label: "Colaboradores", value: String(data.stats.uniqueEmployees), color: [5, 150, 105] as [number, number, number] },
  ]

  kpis.forEach((kpi, i) => {
    const cx = 18 + i * (kpiW + 5)
    drawCard(doc, cx, kpiY, kpiW, kpiH, kpi.color)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(20)
    doc.setTextColor(...kpi.color)
    doc.text(kpi.value, cx + kpiW / 2, kpiY + 17, { align: "center" })
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.label.toUpperCase(), cx + kpiW / 2, kpiY + 25, { align: "center" })
  })

  const chartsY = kpiY + kpiH + 12
  const chartsH = ph - chartsY - 20

  const leftW = (pw - 36 - 10) * 0.5
  drawCard(doc, 18, chartsY, leftW, chartsH)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(30, 41, 59)
  doc.text("TOP EPIS MAIS MOVIMENTADOS", 24, chartsY + 12)
  doc.setDrawColor(241, 245, 249)
  doc.setLineWidth(0.3)
  doc.line(24, chartsY + 15, 18 + leftW - 6, chartsY + 15)

  const epiCount: Record<string, number> = {}
  data.movements.forEach(m => {
    const name = m.ppe?.name || "Outros"
    epiCount[name] = (epiCount[name] || 0) + m.quantity
  })
  const topEpis = Object.entries(epiCount).sort((a, b) => b[1] - a[1]).slice(0, 7)
  const barMaxVal = topEpis[0]?.[1] || 1
  const barAreaY = chartsY + 20
  const barAvailH = chartsH - 28
  const singleBarH = Math.min(barAvailH / Math.max(topEpis.length, 1), 13)
  const barAreaW = leftW - 80

  topEpis.forEach(([name, count], i) => {
    const y = barAreaY + i * singleBarH
    const filledW = (count / barMaxVal) * barAreaW
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(71, 85, 105)
    const truncName = name.length > 20 ? name.slice(0, 20) + "…" : name
    doc.text(truncName, 24, y + singleBarH / 2)
    const barX = 24 + 50
    doc.setFillColor(241, 245, 249)
    doc.roundedRect(barX, y + 1, barAreaW, singleBarH - 4, 2, 2, "F")
    if (filledW > 0) {
      doc.setFillColor(r, g, b)
      doc.roundedRect(barX, y + 1, filledW, singleBarH - 4, 2, 2, "F")
    }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.setTextColor(r, g, b)
    doc.text(String(count), barX + filledW + 4, y + singleBarH / 2)
  })

  const rightX = 18 + leftW + 10
  const rightW = pw - rightX - 18
  const topCardH = 50
  const bottomCardH = chartsH - topCardH - 8

  drawCard(doc, rightX, chartsY, rightW, topCardH)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(30, 41, 59)
  doc.text("DISTRIBUIÇÃO: ENTREGAS vs DEVOLUÇÕES", rightX + 6, chartsY + 11)
  doc.setDrawColor(241, 245, 249)
  doc.setLineWidth(0.3)
  doc.line(rightX + 6, chartsY + 14, rightX + rightW - 6, chartsY + 14)

  const total = data.stats.deliveries + data.stats.returns
  if (total > 0) {
    const delivPct = data.stats.deliveries / total
    const retPct = data.stats.returns / total
    const stackW = rightW - 20
    const stackBarY = chartsY + 20
    const stackBarH = 14
    const delivW = stackW * delivPct
    const retW = stackW * retPct
    if (delivW > 2) {
      doc.setFillColor(37, 99, 235)
      doc.roundedRect(rightX + 10, stackBarY, delivW, stackBarH, 2, 2, "F")
    }
    if (retW > 2) {
      doc.setFillColor(217, 119, 6)
      doc.roundedRect(rightX + 10 + delivW, stackBarY, retW, stackBarH, 2, 2, "F")
    }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.setTextColor(255, 255, 255)
    if (delivW > 20) doc.text(`${Math.round(delivPct * 100)}%`, rightX + 10 + delivW / 2, stackBarY + 10, { align: "center" })
    if (retW > 20) doc.text(`${Math.round(retPct * 100)}%`, rightX + 10 + delivW + retW / 2, stackBarY + 10, { align: "center" })

    const legY = stackBarY + stackBarH + 8
    const halfW = (rightW - 20) / 2
    doc.setFillColor(37, 99, 235)
    doc.roundedRect(rightX + 10, legY, 7, 7, 1, 1, "F")
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(30, 41, 59)
    doc.text(`Entregas: ${data.stats.deliveries}`, rightX + 20, legY + 5.5)
    doc.setFillColor(217, 119, 6)
    doc.roundedRect(rightX + 10 + halfW, legY, 7, 7, 1, 1, "F")
    doc.text(`Devoluções: ${data.stats.returns}`, rightX + 20 + halfW, legY + 5.5)
  }

  const botY = chartsY + topCardH + 8
  drawCard(doc, rightX, botY, rightW, bottomCardH)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(30, 41, 59)
  doc.text("MOVIMENTAÇÕES POR UNIDADE", rightX + 6, botY + 11)
  doc.setDrawColor(241, 245, 249)
  doc.setLineWidth(0.3)
  doc.line(rightX + 6, botY + 14, rightX + rightW - 6, botY + 14)

  const wpCount: Record<string, number> = {}
  data.movements.forEach(m => {
    const wp = m.workplace?.name || "Geral"
    wpCount[wp] = (wpCount[wp] || 0) + 1
  })
  const maxWpRows = Math.max(1, Math.floor((bottomCardH - 22) / 11))
  const topWp = Object.entries(wpCount).sort((a, b) => b[1] - a[1]).slice(0, Math.min(maxWpRows, 5))
  const wpMaxVal = topWp[0]?.[1] || 1
  const labelW = 50
  const wpBarW = rightW - labelW - 24

  topWp.forEach(([wp, count], i) => {
    const rowY = botY + 20 + i * 11
    const filledW = (count / wpMaxVal) * wpBarW
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(71, 85, 105)
    const wpLabel = wp.length > 14 ? wp.slice(0, 14) + "…" : wp
    doc.text(wpLabel, rightX + 8, rowY + 5.5)
    doc.setFillColor(241, 245, 249)
    doc.roundedRect(rightX + 8 + labelW, rowY, wpBarW, 8, 2, 2, "F")
    if (filledW > 0) {
      doc.setFillColor(5, 150, 105)
      doc.roundedRect(rightX + 8 + labelW, rowY, filledW, 8, 2, 2, "F")
    }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.setTextColor(5, 150, 105)
    doc.text(String(count), rightX + 10 + labelW + wpBarW + 2, rowY + 5.5)
  })

  doc.setFillColor(r, g, b)
  doc.rect(0, ph - 14, pw, 14, "F")
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  doc.setTextColor(255, 255, 255)
  doc.text(`${COMPANY_CONFIG.name}  ·  Documento Confidencial  ·  ${COMPANY_CONFIG.systemName}`, pw / 2, ph - 5, { align: "center" })
  doc.text("Página 1 de 2", pw - 18, ph - 5, { align: "right" })

  doc.addPage()
  doc.setFillColor(r, g, b)
  doc.rect(0, 0, pw, 30, "F")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.setTextColor(255, 255, 255)
  doc.text("DETALHAMENTO COMPLETO DE MOVIMENTAÇÕES", 18, 18)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.text(`${data.period}  ·  ${data.movements.length} registros`, pw - 18, 18, { align: "right" })

  autoTable(doc, {
    startY: 36,
    head: [["#", "Data", "Colaborador", "CPF", "EPI / CA", "Qtd", "Tipo", "Unidade"]],
    body: data.movements.map((m, idx) => [
      String(idx + 1),
      format(new Date(m.delivery_date), "dd/MM/yyyy HH:mm"),
      m.employee?.full_name || "-",
      m.employee?.cpf || "-",
      `${m.ppe?.name || "-"} (CA: ${m.ppe?.ca_number || "-"})`,
      String(m.quantity),
      m.returned_at ? "DEVOLUÇÃO" : "ENTREGA",
      m.workplace?.name || "Geral"
    ]),
    headStyles: { fillColor: [r, g, b], fontStyle: "bold", fontSize: 7.5, cellPadding: 4 },
    bodyStyles: { fontSize: 7, cellPadding: 3 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 10, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 26 },
      3: { cellWidth: 26 },
      5: { cellWidth: 12, halign: "center" },
      6: { cellWidth: 22, halign: "center" },
    },
    margin: { left: 14, right: 14 },
    theme: "grid",
    styles: { lineColor: [226, 232, 240], lineWidth: 0.3 },
    didParseCell: (hookData) => {
      if (hookData.column.index === 6 && hookData.section === "body") {
        const val = hookData.cell.raw as string
        if (val === "ENTREGA") {
          hookData.cell.styles.textColor = [5, 150, 105]
          hookData.cell.styles.fontStyle = "bold"
        }
        if (val === "DEVOLUÇÃO") {
          hookData.cell.styles.textColor = [217, 119, 6]
          hookData.cell.styles.fontStyle = "bold"
        }
      }
    }
  })

  doc.setFillColor(r, g, b)
  doc.rect(0, ph - 14, pw, 14, "F")
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  doc.setTextColor(255, 255, 255)
  doc.text(`${COMPANY_CONFIG.name}  ·  Documento Confidencial  ·  ${COMPANY_CONFIG.systemName}`, pw / 2, ph - 5, { align: "center" })
  doc.text("Página 2 de 2", pw - 18, ph - 5, { align: "right" })

  return doc.output("blob")
}
