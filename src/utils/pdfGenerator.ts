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
// 1. FICHA DE ENTREGA (NR-06)
// ─────────────────────────────────────────────

export interface DeliveryPDFData {
  employeeName: string
  employeeCpf: string
  employeeRole: string
  workplaceName: string
  ppeName: string
  ppeCaNumber: string
  quantity: number
  reason: string
  authMethod: 'manual' | 'facial'
  signatureBase64: string
  photoBase64?: string
  ipAddress?: string
  location?: string
  validationHash?: string
}

export async function generateDeliveryPDF(data: DeliveryPDFData): Promise<Blob> {
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const hash = data.validationHash || Math.random().toString(36).substring(2, 12).toUpperCase()

  addPageHeader(doc, "FICHA DE ENTREGA DE E.P.I.", "Certificado de Uso Individual — NR-06 Art. 6°")

  // ── Info boxes ──
  const boxY = 46
  const boxH = 42 // Increased height for better spacing
  const col = (pageWidth - 28) / 2

  doc.setFillColor(248, 250, 252)
  doc.roundedRect(14, boxY, col - 4, boxH, 3, 3, "F")
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.roundedRect(14, boxY, col - 4, boxH, 3, 3, "S")

  infoRow(doc, "Colaborador", data.employeeName, 18, boxY + 8)
  infoRow(doc, "CPF", data.employeeCpf, 18, boxY + 22)
  infoRow(doc, "Cargo / Função", data.employeeRole, 18, boxY + 36)

  doc.setFillColor(248, 250, 252)
  doc.roundedRect(14 + col, boxY, col - 4, boxH, 3, 3, "F")
  doc.setDrawColor(226, 232, 240)
  doc.roundedRect(14 + col, boxY, col - 4, boxH, 3, 3, "S")

  infoRow(doc, "Equipamento (EPI)", data.ppeName, 18 + col, boxY + 8)
  infoRow(doc, "Nº do C.A.", data.ppeCaNumber, 18 + col, boxY + 22)
  infoRow(doc, "Canteiro / Unidade", data.workplaceName, 18 + col, boxY + 36)

  const detY = boxY + boxH + 8
  const colW = (pageWidth - 28) / 4
  const details = [
    { label: "Qtd Entregue", value: String(data.quantity) },
    { label: "Motivo", value: data.reason },
    { label: "Data de Entrega", value: format(new Date(), "dd/MM/yyyy", { locale: ptBR }) },
    { label: "Autenticação", value: data.authMethod === 'facial' ? 'Biometria Facial' : 'Assinatura Manual' },
  ]
  details.forEach((d, i) => {
    infoRow(doc, d.label, d.value, 14 + i * colW, detY + 4)
  })

  const termY = detY + 18
  doc.setFillColor(255, 251, 235)
  doc.setDrawColor(251, 191, 36)
  doc.roundedRect(14, termY, pageWidth - 28, 24, 3, 3, "FD")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  doc.setTextColor(146, 64, 14)
  doc.text("ATENÇÃO: TERMO DE RESPONSABILIDADE", 18, termY + 7)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  doc.setTextColor(120, 53, 15)
  const term = "Declaro ter recebido o(s) EPI(s) listado(s) acima em perfeito estado, comprometendo-me a utilizá-lo(s) para a finalidade a que se destina(m), responsabilizando-me pela sua guarda e conservação conforme NR-06 do MTE."
  doc.text(doc.splitTextToSize(term, pageWidth - 36), 18, termY + 13)

  const sigY = termY + 32

  if (data.authMethod === 'facial' && data.signatureBase64) {
    // ── PHOTO BOX (square, proportional) ──
    const photoSize = 50 // Square photo
    doc.setFillColor(241, 245, 249)
    doc.setDrawColor(203, 213, 225)
    doc.roundedRect(14, sigY, photoSize + 4, photoSize + 4, 3, 3, "FD")
    try {
      doc.addImage(data.signatureBase64, 'JPEG', 16, sigY + 2, photoSize, photoSize)
    } catch { /* silently ignore */ }

    // ── VERIFICATION INFO BOX (right of photo) ──
    const infoX = 14 + photoSize + 10
    const infoW = pageWidth - infoX - 14

    // Green verified badge
    doc.setFillColor(220, 252, 231)
    doc.setDrawColor(134, 239, 172)
    doc.roundedRect(infoX, sigY, infoW, 22, 3, 3, "FD")
    doc.setFontSize(8)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(21, 128, 61)
    doc.text("✓  IDENTIDADE VERIFICADA POR BIOMETRIA FACIAL", infoX + 4, sigY + 8)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(6.5)
    doc.setTextColor(21, 128, 61)
    doc.text(`Motor: face-api.js / TensorFlow.js (AI-Based)`, infoX + 4, sigY + 14)
    doc.text(`Tecnologia: Euclidean Distance Matching`, infoX + 4, sigY + 19)

    // ── METADATA BOX (IP, Location) ──
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(infoX, sigY + 25, infoW, 18, 3, 3, "FD")
    doc.setFontSize(6.5)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(100, 116, 139)
    doc.text("METADADOS DE AUTENTICAÇÃO", infoX + 4, sigY + 31)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(6.5)
    doc.setTextColor(71, 85, 105)
    doc.text(`IP do Dispositivo: ${data.ipAddress || 'Não registrado'}`, infoX + 4, sigY + 37)
    doc.text(`Geolocalização: ${data.location || 'Não capturada'}`, infoX + 4, sigY + 42)

    // ── SIGNATURE LINE ──
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.5)
    doc.line(infoX, sigY + 48, infoX + infoW, sigY + 48)
    doc.setFontSize(7.5)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(100, 116, 139)
    doc.text(data.employeeName.toUpperCase(), infoX + infoW / 2, sigY + 52, { align: "center" })
    doc.setFont("helvetica", "normal")
    doc.setFontSize(6)
    doc.text("Assinatura Biométrica Digital Certificada", infoX + infoW / 2, sigY + 57, { align: "center" })

  } else {
    // ── MANUAL SIGNATURE ──
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(14, sigY, pageWidth - 28, 55, 3, 3, "FD")
    try {
      doc.addImage(data.signatureBase64, 'PNG', (pageWidth - 80) / 2, sigY + 5, 80, 30)
    } catch { /* */ }
    doc.setLineWidth(0.5)
    doc.line(40, sigY + 45, pageWidth - 40, sigY + 45)
    doc.setFontSize(7.5)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(100, 116, 139)
    doc.text(data.employeeName.toUpperCase(), pageWidth / 2, sigY + 50, { align: "center" })

    // ── IP & Location for manual mode too ──
    if (data.ipAddress || data.location) {
      doc.setFontSize(6)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(148, 163, 184)
      doc.text(`IP: ${data.ipAddress || 'N/A'} | Localização: ${data.location || 'N/A'}`, pageWidth / 2, sigY + 55, { align: "center" })
    }
  }

  // ── QR CODE SECTION (always visible, below signature area) ──
  const qrY = sigY + 64
  
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(14, qrY, pageWidth - 14, qrY)

  try {
    const qrText = `${COMPANY_CONFIG.systemName} | Hash: ${hash} | ${format(new Date(), "dd/MM/yyyy HH:mm")}`
    const qrDataUrl = await QRCode.toDataURL(qrText, { width: 200, margin: 1 })
    doc.addImage(qrDataUrl, 'PNG', 14, qrY + 4, 22, 22)
  } catch { /* silently ignore */ }

  // QR legend + Hash info (right of QR)
  doc.setFontSize(7)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(30, 41, 59)
  doc.text("CERTIFICADO DE AUTENTICIDADE", 42, qrY + 9)
  
  doc.setFontSize(6.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(100, 116, 139)
  doc.text(`Hash de Validação: ${hash}`, 42, qrY + 15)
  doc.text(`IP do Terminal: ${data.ipAddress || 'Não registrado'}`, 42, qrY + 20)
  doc.text(`Localização GPS: ${data.location || 'Não capturada'}`, 42, qrY + 25)

  doc.setFontSize(5.5)
  doc.setTextColor(148, 163, 184)
  doc.text("Escaneie o QR Code para verificar a autenticidade deste documento.", 14, qrY + 30)

  addPageFooter(doc, hash, data.ipAddress)
  return doc.output("blob")
}

// ─────────────────────────────────────────────
// 2. RECIBO DE BAIXA / SUBSTITUIÇÃO
// ─────────────────────────────────────────────

export interface ReturnPDFData {
  employeeName: string
  employeeCpf: string
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
