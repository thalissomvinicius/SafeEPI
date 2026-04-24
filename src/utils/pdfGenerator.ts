import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { COMPANY_CONFIG } from "@/config/company"
import QRCode from "qrcode"

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
  // Single item (backward compat)
  ppeCaExpiry?: string
  // Multi-item support
  items?: { ppeName: string; ppeCaNumber: string; caExpiry?: string; quantity: number; reason: string }[]
  authMethod: 'manual' | 'facial'
  signatureBase64: string
  photoBase64?: string
  ipAddress?: string
  location?: string
  validationHash?: string
  deliveryDate?: string // Custom delivery date
}

export async function generateDeliveryPDF(data: DeliveryPDFData): Promise<Blob> {
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const hash = data.validationHash || Math.random().toString(36).substring(2, 12).toUpperCase()

  // Build items array (support both single and multi-item)
  const pdfItems = data.items && data.items.length > 0
    ? data.items
    : [{ ppeName: data.ppeName, ppeCaNumber: data.ppeCaNumber, caExpiry: data.ppeCaExpiry, quantity: data.quantity, reason: data.reason }]

  // 1. HEADER (SaaS Premium Style)
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

  // 2. CARD: COLABORADOR (3 Columns)
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

  // 3. CARD: DADOS DO EPI (Table — supports multiple items)
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

  // 4. CARD: TERMO DE RESPONSABILIDADE
  // @ts-ignore
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

  // 5. CARD: BIOMETRIA / ASSINATURA
  // Smart detection: use actual image dimensions to decide rendering mode
  // Photos are portrait/square, signatures are wide landscape drawings
  currentY += 35
  
  let isPhoto = data.authMethod === 'facial' // Start with declared method
  let imgRatio = 1
  
  if (data.signatureBase64) {
    try {
      const imgProps = doc.getImageProperties(data.signatureBase64)
      imgRatio = imgProps.width / imgProps.height
      // If image is roughly square or portrait (ratio <= 1.5), it's likely a photo
      // Signature drawings are always very wide (ratio > 2)
      if (imgRatio <= 1.5) isPhoto = true
      if (imgRatio > 2.5) isPhoto = false
    } catch { /* keep declared method */ }
  }

  if (isPhoto && data.signatureBase64) {
    // ── BIOMETRIC PHOTO (proportional, centered) ──
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
      // Calculate proportional dimensions to fit inside container WITHOUT stretching
      let drawW: number, drawH: number
      
      if (imgRatio >= 1) {
        // Landscape or square: fit to width, calculate height
        drawW = containerSize
        drawH = containerSize / imgRatio
      } else {
        // Portrait: fit to height, calculate width
        drawH = containerSize
        drawW = containerSize * imgRatio
      }
      
      const drawX = containerX + (containerSize - drawW) / 2
      const drawY = currentY + 7 + (containerSize - drawH) / 2
      
      doc.addImage(data.signatureBase64, 'JPEG', drawX, drawY, drawW, drawH)
    } catch (e) {
      console.error("Error adding photo to PDF", e)
    }
    
    // Employee name below photo
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
    // ── MANUAL SIGNATURE (proportional) ──
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.setTextColor(71, 85, 105)
    doc.text("ASSINATURA DO COLABORADOR", pageWidth / 2, currentY, { align: "center" })
    
    // Signature container
    const sigBoxW = 100
    const sigBoxH = 30
    const sigBoxX = (pageWidth - sigBoxW) / 2
    
    doc.setDrawColor(226, 232, 240)
    doc.setFillColor(252, 252, 252)
    doc.roundedRect(sigBoxX, currentY + 4, sigBoxW, sigBoxH, 2, 2, "FD")
    
    try {
      // Fit signature proportionally inside the box
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
    
    // Signature line
    doc.setDrawColor(200, 200, 200)
    doc.line(sigBoxX + 10, currentY + sigBoxH + 6, sigBoxX + sigBoxW - 10, currentY + sigBoxH + 6)
    
    doc.setFontSize(8)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(30, 41, 59)
    doc.text(data.employeeName.toUpperCase(), pageWidth / 2, currentY + sigBoxH + 12, { align: "center" })
    
    currentY += sigBoxH + 22
  }

  // 6. CARD: AUTENTICAÇÃO (2 Columns)
  doc.setFillColor(252, 252, 252)
  doc.setDrawColor(240, 240, 240)
  doc.roundedRect(14, currentY, pageWidth - 28, 35, 3, 3, "FD")
  
  // Left: Metadata
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

  // Right: QR Code
  try {
    const qrText = `${COMPANY_CONFIG.systemName} | Valid: ${hash} | Date: ${today}`
    const qrDataUrl = await QRCode.toDataURL(qrText, { width: 200, margin: 1 })
    doc.addImage(qrDataUrl, 'PNG', pageWidth - 45, currentY + 5, 25, 25)
    doc.setFontSize(6)
    doc.setTextColor(200, 200, 200)
    doc.text("Scan to Verify", pageWidth - 32, currentY + 33, { align: "center" })
  } catch {}

  // 7. FOOTER (dynamic position — after auth card, not fixed to page bottom)
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
      // Square photo, proportional
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
  }[]
}

export function generateNR06PDF(data: NR06PDFData): void {
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()

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
    const y = boxY + Math.floor(i / 3) * 16
    infoRow(doc, f.label, f.value, x, y)
  })

  const tableY = boxY + 38
  autoTable(doc, {
    startY: tableY,
    head: [["Data Entrega", "EPI", "Nº C.A.", "Qtd", "Motivo", "Status", "Data Devolução"]],
    body: data.items.map(item => [
      item.deliveryDate,
      item.ppeName,
      item.caNr,
      item.quantity,
      item.reason,
      item.returnedAt ? "Devolvido" : item.isExpired ? "⚠ Troca Pendente" : "Em uso",
      item.returnedAt ? format(new Date(item.returnedAt), "dd/MM/yyyy") : "—"
    ]),
    styles: {
      fontSize: 7.5,
      cellPadding: 4,
      font: "helvetica",
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [r, g, b],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7,
      halign: "center",
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 22 },
      2: { halign: "center", cellWidth: 16 },
      3: { halign: "center", cellWidth: 10 },
      5: { halign: "center" },
      6: { halign: "center", cellWidth: 24 },
    },
    willDrawCell: (hookData) => {
      if (hookData.section === 'body' && hookData.column.index === 5) {
        const val = String(hookData.cell.raw)
        if (val.includes("Troca")) hookData.cell.styles.textColor = [r, g, b]
        if (val === "Devolvido") hookData.cell.styles.textColor = [21, 128, 61]
      }
    },
    margin: { left: 14, right: 14 },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable?.finalY || 200
  const emitDate = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
  doc.setFontSize(7)
  doc.setFont("helvetica", "italic")
  doc.setTextColor(100, 116, 139)
  doc.text(`Documento emitido em ${emitDate} pelo ${COMPANY_CONFIG.systemName}.`, 14, finalY + 10)

  addPageFooter(doc)
  doc.save(`Ficha_NR06_${data.employeeName.replace(/\s+/g, '_')}.pdf`)
}

// ─────────────────────────────────────────────
// 3. RELATÓRIO GERAL (ANALYTICS)
// ─────────────────────────────────────────────

export interface ReportPDFData {
  stats: { label: string; value: string; change: string }[]
  deliveries: any[] // Array of deliveries to list
  periodTitle?: string
}

export function generateGeneralReportPDF(data: ReportPDFData) {
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()

  const subtitle = data.periodTitle ? `Métricas Globais e Rastreabilidade • ${data.periodTitle}` : "Métricas Globais e Rastreabilidade (NR-06)"
  addPageHeader(doc, "RELATÓRIO DE CONFORMIDADE E CUSTOS", subtitle)

  // Metrics Dashboard
  let currentY = 50
  
  doc.setFontSize(10)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(r, g, b)
  doc.text("MÉTRICAS GLOBAIS", 14, currentY)
  currentY += 8

  // Draw 4 cards for metrics
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

  const recentDeliveries = data.deliveries.slice(0, 50) // Limit to 50 for the PDF

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable?.finalY || 200
  const emitDate = format(new Date(), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })
  doc.setFontSize(7)
  doc.setFont("helvetica", "italic")
  doc.setTextColor(100, 116, 139)
  doc.text(`Relatório gerado em ${emitDate} pelo sistema.`, 14, finalY + 10)

  addPageFooter(doc)
  doc.save(`Relatorio_Global_EPIs_${format(new Date(), "yyyyMMdd")}.pdf`)
}
