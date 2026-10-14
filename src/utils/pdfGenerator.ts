import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { COMPANY_CONFIG } from "@/config/company"
import QRCode from "qrcode"
import { DeliveryWithRelations, Employee, PPE } from "@/types/database"
import { generateAuditCode } from "@/utils/auditCode"
import { getStoredBrand, hexToRgb } from "@/lib/brandTheme"
import { formatDateOnly, formatDeliveryDate, formatDeliveryTime, getDaysUntilDateOnly } from "@/lib/dateOnly"
import { calculateTrainingValidity, getTrainingWorkloadRule } from "@/utils/trainingValidity"
import { fetchImageDataUrl } from "@/utils/imageDataUrl"

let [r, g, b] = COMPANY_CONFIG.primaryColorRgb
type AuthMethod = 'manual' | 'facial' | 'manual_facial' | 'fingerprint'

function normalizeLegacyPdfText(value: string | null | undefined) {
  const replacements: Array<[string, string]> = [
    ["Ã§", "ç"], ["Ã£", "ã"], ["Ã¡", "á"], ["Ã ", "à"], ["Ã¢", "â"],
    ["Ã©", "é"], ["Ãª", "ê"], ["Ã­", "í"], ["Ã³", "ó"],
    ["Ã´", "ô"], ["Ãµ", "õ"], ["Ãº", "ú"], ["Ãƒ", "Ã"],
    ["Âº", "º"], ["Âª", "ª"], ["Â·", "·"],
    ["â€¢", "•"], ["â€“", "–"], ["â€”", "—"],
  ]
  return replacements.reduce((text, [broken, fixed]) => text.replaceAll(broken, fixed), value || "")
}

function refreshPdfBrand() {
  const brand = getStoredBrand()
  ;[r, g, b] = hexToRgb(brand.primaryColor)
  return brand
}

function getPdfLogoDataUrl() {
  return getStoredBrand().logoDataUrl
}

function getPdfCompanyName() {
  return getStoredBrand().name || COMPANY_CONFIG.name
}

function getImageFormat(dataUrl: string) {
  return dataUrl.includes("image/jpeg") || dataUrl.includes("image/jpg") ? "JPEG" : "PNG"
}

function addImageContained(doc: jsPDF, image: string, x: number, y: number, maxW: number, maxH: number, align: "left" | "center" = "center") {
  const props = doc.getImageProperties(image)
  const ratio = props.width / props.height
  let drawW = maxW
  let drawH = drawW / ratio

  if (drawH > maxH) {
    drawH = maxH
    drawW = drawH * ratio
  }

  const drawX = align === "center" ? x + (maxW - drawW) / 2 : x
  const drawY = y + (maxH - drawH) / 2
  doc.addImage(image, getImageFormat(image), drawX, drawY, drawW, drawH)
}

function addPdfLogo(doc: jsPDF, x: number, y: number, maxW: number, maxH: number) {
  const logo = getPdfLogoDataUrl()
  if (!logo) return false

  try {
    addImageContained(doc, logo, x, y, maxW, maxH, "left")
    return true
  } catch {
    return false
  }
}

function addPageHeader(doc: jsPDF, title: string, subtitle: string) {
  const pageWidth = doc.internal.pageSize.getWidth()
  // A restrained stationery header stays legible in print and leaves the
  // company identity in the accent, rather than filling the paper with ink.
  doc.setFillColor(r, g, b)
  doc.rect(14, 6, pageWidth - 28, 1.2, "F")
  doc.setTextColor(r, g, b)
  doc.setFontSize(8)
  doc.setFont("helvetica", "bold")
  if (!addPdfLogo(doc, 14, 10, 24, 9)) {
    const companyLines = doc.splitTextToSize(getPdfCompanyName().toUpperCase(), pageWidth - 85) as string[]
    doc.text(companyLines, 14, 15, { lineHeightFactor: 1.15 })
  }
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(12.5)
  doc.setFont("helvetica", "bold")
  doc.text(title, 14, 27)
  doc.setFontSize(7.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(100, 116, 139)
  doc.text(subtitle, 14, 33)
  doc.setFontSize(6.5)
  doc.text("EMISSÃO DO DOCUMENTO", pageWidth - 14, 12, { align: "right" })
  doc.setFontSize(7)
  doc.text(format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR }), pageWidth - 14, 17, { align: "right" })
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.25)
  doc.line(14, 38, pageWidth - 14, 38)
  doc.setTextColor(30, 41, 59)
}

function addDocumentFooters(doc: jsPDF, label: string) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const totalPages = doc.getNumberOfPages()
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.25)
    doc.line(14, pageHeight - 18, pageWidth - 14, pageHeight - 18)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(6.5)
    doc.setTextColor(100, 116, 139)
    const footerLines = doc.splitTextToSize(`${COMPANY_CONFIG.systemName} • ${label}`, pageWidth - 70) as string[]
    doc.text(footerLines, 14, pageHeight - 12, { lineHeightFactor: 1.1 })
    doc.text(`Página ${page} de ${totalPages}`, pageWidth - 14, pageHeight - 12, { align: "right" })
  }
}

function addReportHeader(doc: jsPDF, title: string, subtitle: string, context: string) {
  addPageHeader(doc, title, subtitle)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(7)
  doc.setTextColor(r, g, b)
  const lines = doc.splitTextToSize(context || "Conjunto completo", doc.internal.pageSize.getWidth() - 30) as string[]
  doc.text(lines, 14, 45, { lineHeightFactor: 1.2 })
}

function drawManualSignatureLine(
  doc: jsPDF,
  centerX: number,
  lineY: number,
  width: number,
  signerName: string,
  role = "Assinatura manual",
  note = "Assinar manualmente sobre a linha"
) {
  doc.setDrawColor(148, 163, 184)
  doc.setLineWidth(0.35)
  doc.line(centerX - width / 2, lineY, centerX + width / 2, lineY)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  doc.setTextColor(30, 41, 59)
  const nameLines = doc.splitTextToSize((signerName || "Responsavel pela assinatura").toUpperCase(), width) as string[]
  doc.text(nameLines, centerX, lineY + 5, { align: "center", lineHeightFactor: 1.25 })
  const nameOffset = (nameLines.length - 1) * 3.3
  doc.setFont("helvetica", "normal")
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  const roleLines = doc.splitTextToSize(role, width) as string[]
  doc.text(roleLines, centerX, lineY + 9 + nameOffset, { align: "center", lineHeightFactor: 1.2 })
  doc.setFontSize(6)
  doc.setTextColor(148, 163, 184)
  doc.text(note, centerX, lineY + 13 + nameOffset + (roleLines.length - 1) * 2.8, { align: "center" })
}

function drawSignatureCellLine(doc: jsPDF, cell: { x: number; y: number; width: number; height: number }) {
  const lineY = cell.y + cell.height - 5
  doc.setDrawColor(148, 163, 184)
  doc.setLineWidth(0.25)
  doc.line(cell.x + 3, lineY, cell.x + cell.width - 3, lineY)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(5.5)
  doc.setTextColor(100, 116, 139)
  doc.text("Assinatura manual", cell.x + cell.width / 2, Math.min(lineY + 3, cell.y + cell.height - 1), { align: "center" })
}

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
  items?: { ppeName: string; ppeCaNumber: string; caExpiry?: string; quantity: number; reason: string; autoReturnNote?: string }[]
  authMethod: AuthMethod
  signatureBase64?: string
  photoBase64?: string
  fingerprintEvidence?: FingerprintReceiptMetadata
  ipAddress?: string
  location?: string
  locationSource?: "device" | "network"
  validationHash?: string
  deliveryDate?: string
  biometricReceipt?: BiometricReceiptMetadata
}

export interface FingerprintReceiptMetadata {
  code: string
  terminalName: string
  completedAt: string
  resultHash: string
}

/** Receipt fields must come from the server response after transaction confirmation.
 * This renderer displays evidence; it is not a biometric or cryptographic verifier.
 */
export interface BiometricReceiptMetadata {
  session_id: string
  accepted_at: string
  model_id: string
  calibration_id: string
  context_hash: string
  similarity?: number
  threshold?: number
  pad_model_id?: string
}

function completeBiometricReceipt(value?: BiometricReceiptMetadata): value is BiometricReceiptMetadata {
  if (!value || typeof value !== "object") return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.session_id || "")
    && [value.model_id, value.calibration_id].every(part => typeof part === "string" && part.trim().length > 0)
    && /^[0-9a-f]{64}$/i.test(value.context_hash || "")
    && typeof value.accepted_at === "string"
    && Number.isFinite(Date.parse(value.accepted_at))
}

export async function generateDeliveryPDF(data: DeliveryPDFData): Promise<Blob> {
  refreshPdfBrand()
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  const bottom = pageHeight - 24
  const reference = data.validationHash || generateAuditCode()
  const receipt = data.authMethod === "facial" && completeBiometricReceipt(data.biometricReceipt)
    ? data.biometricReceipt
    : undefined
  const pdfItems = data.items?.length
    ? data.items
    : [{ ppeName: data.ppeName || "", ppeCaNumber: data.ppeCaNumber || "", caExpiry: data.ppeCaExpiry, quantity: data.quantity || 0, reason: data.reason || "" }]
  const today = data.deliveryDate
    ? `${formatDeliveryDate(data.deliveryDate)} ${formatDeliveryTime(data.deliveryDate)}`
    : format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })
  let currentY = 49

  const header = () => addPageHeader(doc, "FICHA DE ENTREGA DE EPI", "Registro de recebimento e evidências")
  header()

  const ensureSpace = (height: number) => {
    if (currentY + height <= bottom) return
    doc.addPage()
    header()
    currentY = 49
  }
  const write = (value: string, size = 8, bold = false, color: [number, number, number] = [30, 41, 59], width = contentWidth) => {
    doc.setFont("helvetica", bold ? "bold" : "normal")
    doc.setFontSize(size)
    const lineHeight = size / doc.internal.scaleFactor * doc.getLineHeightFactor() + 0.8
    // Built-in Helvetica metrics are rounded; a small inset also keeps long,
    // unbroken identifiers inside the margins in precise PDF renderers.
    const lines = doc.splitTextToSize(normalizeLegacyPdfText(value) || "-", width - 2) as string[]
    for (const line of lines) {
      ensureSpace(lineHeight)
      // A continuation header changes text styling, so restore it for every line.
      doc.setFont("helvetica", bold ? "bold" : "normal")
      doc.setFontSize(size)
      doc.setTextColor(...color)
      doc.text(line, margin, currentY)
      currentY += lineHeight
    }
  }
  const field = (label: string, value: string, width = contentWidth) => {
    ensureSpace(11)
    write(label.toUpperCase(), 6.5, true, [100, 116, 139])
    write(value, 8, false, [30, 41, 59], width)
    currentY += 1
  }
  const section = (title: string) => {
    ensureSpace(15)
    doc.setDrawColor(226, 232, 240)
    doc.line(margin, currentY - 3, pageWidth - margin, currentY - 3)
    write(title, 9, true, [r, g, b])
    currentY += 1
  }

  write(data.employeeName.toUpperCase(), 12, true, [r, g, b])
  currentY += 4
  const identityFields = [
    { label: "CPF", value: data.employeeCpf },
    { label: "Cargo / função", value: data.employeeRole || "Não informado" },
    { label: "Unidade / canteiro", value: data.workplaceName || "Sede" },
    { label: "Data da entrega", value: today },
  ]
  const identityColumnWidth = (contentWidth - 8) / 2
  for (let row = 0; row < 2; row += 1) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    const values = identityFields.slice(row * 2, row * 2 + 2).map(entry => ({
      ...entry,
      lines: doc.splitTextToSize(normalizeLegacyPdfText(entry.value), identityColumnWidth - 2) as string[],
    }))
    const rowHeight = 8 + Math.max(...values.map(entry => entry.lines.length)) * 4
    ensureSpace(rowHeight)
    values.forEach((entry, column) => {
      const x = margin + column * (identityColumnWidth + 8)
      doc.setFont("helvetica", "bold")
      doc.setFontSize(6.5)
      doc.setTextColor(100, 116, 139)
      doc.text(entry.label.toUpperCase(), x, currentY)
      doc.setFont("helvetica", "normal")
      doc.setFontSize(8.5)
      doc.setTextColor(30, 41, 59)
      doc.text(entry.lines, x, currentY + 5, { lineHeightFactor: 1.3 })
    })
    currentY += rowHeight + 3
  }
  section("EQUIPAMENTOS ENTREGUES")
  ensureSpace(24)

  const tableStartPage = doc.getCurrentPageInfo().pageNumber
  autoTable(doc, {
    startY: currentY,
    head: [["Equipamento (EPI)", "Nº CA", "Venc. CA", "Qtd", "Motivo", "Data Entrega"]],
    body: pdfItems.map(item => [
      normalizeLegacyPdfText(item.ppeName),
      item.ppeCaNumber,
      item.caExpiry ? formatDateOnly(item.caExpiry) : "-",
      String(item.quantity),
      normalizeLegacyPdfText(item.autoReturnNote ? `${item.reason}\n${item.autoReturnNote}` : item.reason),
      today,
    ]),
    styles: { fontSize: 7.5, cellPadding: 3, font: "helvetica", overflow: "linebreak", lineColor: [226, 232, 240], lineWidth: 0.15, textColor: [30, 41, 59] },
    headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold", fontSize: 7 },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    columnStyles: { 0: { cellWidth: 57, fontStyle: "bold" }, 1: { cellWidth: 19, halign: "center" }, 2: { cellWidth: 23, halign: "center" }, 3: { cellWidth: 13, halign: "center", fontStyle: "bold" }, 5: { cellWidth: 27 } },
    margin: { left: margin, right: margin, top: 46, bottom: 24 },
    theme: "striped",
    rowPageBreak: "avoid",
    didDrawPage: () => {
      if (doc.getCurrentPageInfo().pageNumber > tableStartPage) header()
    },
  })
  // @ts-expect-error - jsPDF-autotable adds lastAutoTable to doc
  currentY = doc.lastAutoTable.finalY + 12

  section("TERMO DE RECEBIMENTO")
  write("Declaro ter recebido o(s) EPI(s) listado(s) neste comprovante em perfeito estado, comprometendo-me a utilizá-lo(s) para a finalidade a que se destina(m) e a cuidar de sua guarda e conservação. A forma de confirmação e as evidências disponíveis estão descritas abaixo.", 7.5)
  currentY += 5

  section("FORMA DE CONFIRMAÇÃO")
  const hasManualSignature = (data.authMethod === "manual" || data.authMethod === "manual_facial") && Boolean(data.signatureBase64)
  const supportingPhoto = data.authMethod === "manual_facial" ? data.photoBase64 : undefined
  const facePhoto = data.authMethod === "facial" ? data.photoBase64 || data.signatureBase64 : undefined
  if (data.authMethod === "fingerprint") {
    write(data.fingerprintEvidence ? "Confirmação por impressão digital registrada" : "Impressão digital — evidência indisponível neste arquivo", 9, true)
  } else if (receipt) {
    write("Verificação facial registrada", 9, true)
  } else if (data.authMethod === "facial") {
    write("Registro fotográfico — verificação biométrica não comprovada neste arquivo", 8, true)
  } else if (data.authMethod === "manual_facial") {
    write(hasManualSignature ? "Assinatura manual com foto de apoio" : "Foto de apoio; assinatura manual pendente", 8, true)
  } else {
    write(hasManualSignature ? "Assinatura manual registrada" : "Assinatura manual pendente", 8, true)
  }
  currentY += 2

  if (facePhoto || supportingPhoto || hasManualSignature) {
    const imageHeight = facePhoto ? 45 : supportingPhoto ? 38 : 30
    ensureSpace(imageHeight + 7)
    doc.setDrawColor(226, 232, 240)
    if (facePhoto) {
      const x = (pageWidth - 45) / 2
      doc.roundedRect(x, currentY, 45, 45, 2, 2, "S")
      try { addImageContained(doc, facePhoto, x + 2, currentY + 2, 41, 41) } catch { /* The modality above remains explicit even when an old asset is unavailable. */ }
    } else {
      const signatureX = supportingPhoto ? 74 : (pageWidth - 100) / 2
      if (supportingPhoto) {
        doc.roundedRect(24, currentY, 38, 38, 2, 2, "S")
        try { addImageContained(doc, supportingPhoto, 26, currentY + 2, 34, 34) } catch { /* Optional supporting photo. */ }
      }
      if (hasManualSignature && data.signatureBase64) {
        doc.roundedRect(signatureX, currentY, 100, 30, 2, 2, "S")
        try { addImageContained(doc, data.signatureBase64, signatureX + 3, currentY + 3, 94, 24) } catch { /* Preserve the receipt if an archived image cannot be decoded. */ }
      }
    }
    currentY += imageHeight + 7
  }
  if ((data.authMethod === "manual" || data.authMethod === "manual_facial") && !hasManualSignature) {
    ensureSpace(27)
    currentY += 15
    doc.setDrawColor(148, 163, 184)
    doc.line(margin + 25, currentY, pageWidth - margin - 25, currentY)
    currentY += 5
    write("Assinar manualmente sobre a linha", 7, false, [100, 116, 139])
  }
  write(data.employeeName.toUpperCase(), 8, true)
  currentY += 5

  if (data.authMethod === "fingerprint" && data.fingerprintEvidence) {
    const evidence = data.fingerprintEvidence
    section("EVIDÊNCIAS DA IMPRESSÃO DIGITAL")
    field("Código da evidência", evidence.code)
    field("Terminal de confirmação", evidence.terminalName)
    field("Data e hora da confirmação", `${formatDeliveryDate(evidence.completedAt)} ${formatDeliveryTime(evidence.completedAt)}`)
    field("Hash do resultado registrado", evidence.resultHash)
    write("As informações acima identificam a evidência registrada pelo terminal e devem ser conferidas no histórico do sistema.", 7, false, [100, 116, 139])
    currentY += 6
  }

  if (receipt) {
    section("EVIDÊNCIAS DA TRANSAÇÃO")
    field("Sessão de verificação", receipt.session_id)
    field("Aceite do recebimento (horário do servidor, UTC)", new Date(receipt.accepted_at).toISOString())
    field("Modelo de reconhecimento", receipt.model_id)
    field("Calibração aplicada", receipt.calibration_id)
    if (receipt.pad_model_id) field("Modelo de prova de vida", receipt.pad_model_id)
    if (typeof receipt.similarity === "number" && Number.isFinite(receipt.similarity)
      && typeof receipt.threshold === "number" && Number.isFinite(receipt.threshold)) {
      field("Comparação e limiar aplicados", `${receipt.similarity.toFixed(4)} / ${receipt.threshold.toFixed(4)}`)
    }
    field("SHA-256 do contexto da transação", receipt.context_hash)
    write("Esses dados identificam o registro mantido pelo sistema. Este PDF não é um certificado ICP-Brasil; o hash do contexto não comprova, isoladamente, a autoria do aceite.", 7, false, [100, 116, 139])
    currentY += 6
  }

  let qrDataUrl: string | undefined
  try {
    qrDataUrl = await QRCode.toDataURL(`${COMPANY_CONFIG.systemName} | Referência: ${reference} | Data: ${today}`, { width: 200, margin: 1 })
  } catch { /* The human-readable reference remains available. */ }

  // Keep the QR beside the reference/IP instead of pushing an isolated QR
  // onto a final page. Reserve the section and both columns together.
  ensureSpace(qrDataUrl ? 42 : 15)
  section("INFORMAÇÕES DO REGISTRO")
  const recordTop = currentY
  const recordPage = doc.getCurrentPageInfo().pageNumber
  if (qrDataUrl) {
    const qrColumnX = pageWidth - margin - 33
    doc.addImage(qrDataUrl, "PNG", qrColumnX + 5, recordTop, 23, 23)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(6.5)
    doc.setTextColor(100, 116, 139)
    doc.text("QR de referência do registro", qrColumnX, recordTop + 26)
  }
  const recordWidth = qrDataUrl ? contentWidth - 42 : contentWidth
  field("Código de referência", reference, recordWidth)
  field("IP do terminal", data.ipAddress || "Não registrado neste arquivo", recordWidth)
  if (qrDataUrl && doc.getCurrentPageInfo().pageNumber === recordPage) {
    // The short geolocation label can share the caption's row on the left;
    // its full-width value starts below both the QR and its caption.
    currentY = Math.max(currentY, recordTop + 26)
  }
  field(data.locationSource === "network" ? "Geolocalização (rede aproximada)" : "Geolocalização", data.location || "Coordenadas não capturadas")
  write("O código de referência serve para localizar o registro; não é o hash deste arquivo PDF. A integridade do arquivo arquivado deve ser consultada no histórico do sistema.", 7, false, [100, 116, 139])

  addDocumentFooters(doc, "Entrega de EPI • Evidências conforme modalidade informada")
  return doc.output("blob")
}

export interface ReturnPDFData {
  employeeName: string
  employeeCpf: string
  workplaceName: string
  returnedItemName: string
  returnMotive: string
  newItemName?: string
  newItemCa?: string
  authMethod: AuthMethod
  signatureBase64?: string
  photoBase64?: string
  fingerprintEvidence?: FingerprintReceiptMetadata
  validationHash?: string
}

export async function generateReturnPDF(data: ReturnPDFData): Promise<Blob> {
  refreshPdfBrand()
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const contentWidth = pageWidth - 28
  let currentY = 49
  const header = () => addPageHeader(doc, "RECIBO DE DEVOLUÇÃO / SUBSTITUIÇÃO", "Movimentação de equipamento e confirmação do colaborador")
  header()
  const ensureSpace = (height: number) => {
    if (currentY + height <= pageHeight - 24) return
    doc.addPage()
    header()
    currentY = 49
  }
  const write = (value: string, size = 8, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal")
    doc.setFontSize(size)
    const lines = doc.splitTextToSize(normalizeLegacyPdfText(value) || "-", contentWidth - 2) as string[]
    const lineHeight = size * 25.4 / 72 * 1.35 + 0.7
    for (const line of lines) {
      ensureSpace(lineHeight)
      doc.setFont("helvetica", bold ? "bold" : "normal")
      doc.setFontSize(size)
      doc.setTextColor(30, 41, 59)
      doc.text(line, 14, currentY)
      currentY += lineHeight
    }
  }
  const section = (label: string) => {
    ensureSpace(15)
    doc.setDrawColor(226, 232, 240)
    doc.line(14, currentY - 3, pageWidth - 14, currentY - 3)
    write(label, 8.5, true)
    currentY += 3
  }
  write(data.employeeName.toUpperCase(), 11, true)
  currentY += 3
  write(`CPF: ${data.employeeCpf}`, 8)
  write(`Unidade: ${data.workplaceName || "Não informada"}`, 8)
  currentY += 7
  section("EQUIPAMENTOS MOVIMENTADOS")
  const firstTablePage = doc.getCurrentPageInfo().pageNumber
  autoTable(doc, {
    startY: currentY,
    head: [["Movimentação", "Equipamento", "Detalhes"]],
    body: [
      ["Devolução / baixa", normalizeLegacyPdfText(data.returnedItemName), `Motivo: ${normalizeLegacyPdfText(data.returnMotive)}`],
      ...(data.newItemName ? [["Nova entrega", normalizeLegacyPdfText(data.newItemName), `CA: ${data.newItemCa || "Não informado"}`]] : []),
    ],
    styles: { font: "helvetica", fontSize: 8, cellPadding: 4, textColor: [30, 41, 59], overflow: "linebreak", lineColor: [226, 232, 240], lineWidth: 0.15 },
    headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold", fontSize: 7 },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 88, fontStyle: "bold" } },
    margin: { left: 14, right: 14, top: 46, bottom: 24 },
    rowPageBreak: "avoid",
    theme: "striped",
    didDrawPage: () => { if (doc.getCurrentPageInfo().pageNumber > firstTablePage) header() },
  })
  currentY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12
  section("CONFIRMAÇÃO DA MOVIMENTAÇÃO")
  const term = data.newItemName
    ? "Confirmo a devolução do item antigo e o recebimento do novo equipamento listado acima em perfeitas condições de uso."
    : "Confirmo a devolução do item acima, encerrando minha responsabilidade sobre o mesmo. Estou ciente das implicações legais conforme NR-06."
  write(term, 8)
  currentY += 9
  const facePhoto = data.authMethod === "facial" ? data.photoBase64 || data.signatureBase64 : undefined
  const manualSignature = data.authMethod === "manual" || data.authMethod === "manual_facial" ? data.signatureBase64 : undefined
  const supportingPhoto = data.authMethod === "manual_facial" ? data.photoBase64 : undefined
  write(data.authMethod === "fingerprint" ? "Confirmação por impressão digital" : facePhoto ? "Registro fotográfico (sem prova biométrica neste arquivo)" : manualSignature ? "Assinatura manual registrada" : "Assinatura manual pendente", 7.5, true)
  if (data.authMethod === "fingerprint") {
    if (data.fingerprintEvidence) {
      write(`Evidência: ${data.fingerprintEvidence.code}`, 8)
      write(`Terminal: ${data.fingerprintEvidence.terminalName}`, 8)
      write(`Confirmação: ${formatDeliveryDate(data.fingerprintEvidence.completedAt)} ${formatDeliveryTime(data.fingerprintEvidence.completedAt)}`, 8)
      write(`Hash do resultado: ${data.fingerprintEvidence.resultHash}`, 7)
    } else {
      write("Evidência da impressão digital indisponível neste arquivo. Consulte o histórico do sistema.", 8)
    }
  }
  currentY += 5
  if (data.authMethod !== "fingerprint") {
    ensureSpace(52)
    const sigY = currentY
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.25)
    doc.roundedRect(14, sigY, contentWidth, 42, 2, 2, "S")
    try {
      if (facePhoto) {
        addImageContained(doc, facePhoto, (pageWidth - 36) / 2, sigY + 3, 36, 36)
      } else if (manualSignature) {
        if (supportingPhoto) addImageContained(doc, supportingPhoto, 23, sigY + 4, 32, 32)
        addImageContained(doc, manualSignature, supportingPhoto ? 64 : 38, sigY + 7, supportingPhoto ? 116 : 134, 28)
      }
    } catch { /* Preserve the explicit modality when an old image cannot be decoded. */ }
    if (!facePhoto && !manualSignature) {
      doc.setDrawColor(148, 163, 184)
      doc.line(30, sigY + 31, pageWidth - 30, sigY + 31)
    }
    currentY += 48
  }
  write(data.employeeName.toUpperCase(), 8, true)
  write(`Documento emitido em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 7)
  currentY += 8
  section("INFORMAÇÕES DO REGISTRO")
  write("CÓDIGO DE REFERÊNCIA", 6.5, true)
  write(data.validationHash || "PENDENTE", 8)
  currentY += 2
  write("O código serve para localizar o registro; a integridade do PDF arquivado deve ser consultada no histórico do sistema.", 7)
  addDocumentFooters(doc, "Devolução / substituição de EPI • Registro documental")
  return doc.output("blob")
}

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
    authMethod?: AuthMethod | null
    signatureUrl?: string | null
    signatureBase64?: string
    photoEvidenceUrl?: string | null
    photoBase64?: string
    fingerprintEvidenceCode?: string
  }[]
  tstSigner?: {
    name: string
    role: string
    signatureBase64: string
    authMethod: AuthMethod
    photoBase64?: string
  }
}

// Text supplied by the company for its employee record; keep its wording intact.
export const EPI_RESPONSIBILITY_TERM = {
  title: "TERMO DE RESPONSABILIDADE – ENTREGA DE EPI",
  paragraphs: [
    "Declaro que recebi o(s) equipamento(s) e/ou material, os quais me comprometo a utilizar de acordo com a NR-6, e as orientações técnicas que me foram dadas quanto ao seu uso nos locais determinados pela empresa, responsabilizando-me também pela guarda e conservação dos mesmos, respondendo pelo eventual desaparecimento e/ou danos causados por descuido ou mau uso.",
    "Comprometo-me ainda a apresentar para troca todo equipamento que no decorrer do uso apresentar defeito ou desgaste natural da utilização.",
    "Declaro também estar ciente de que o não uso dos EPI por parte da empresa, conforme a Lei nº 6.514, de 22/12/1977, artigo 158, parágrafo único, e NR-6, item 6.7.1 da Portaria 3.214, de 08/06/1978.",
  ],
} as const

export async function generateNR06PDF(data: NR06PDFData): Promise<Blob> {
  refreshPdfBrand()
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  addPageHeader(doc, "FICHA DE CONTROLE DE EPI - NR-06", "Documento de Prontuário Individual do Colaborador")

  const paragraphLineHeight = 8.5 * 25.4 / 72 * 1.35
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  const termParagraphLines = EPI_RESPONSIBILITY_TERM.paragraphs.map(paragraph => doc.splitTextToSize(paragraph, pageWidth - 37) as string[])
  const termHeight = 18 + termParagraphLines.reduce((height, lines) => height + lines.length * paragraphLineHeight + 4, 0)
  doc.setFillColor(249, 250, 252)
  doc.rect(14, 43, pageWidth - 28, termHeight, "F")
  doc.setFillColor(r, g, b)
  doc.rect(14, 43, 0.8, termHeight, "F")
  let contentY = 51
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(r, g, b)
  doc.text(EPI_RESPONSIBILITY_TERM.title, 18, contentY)
  contentY += 7
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(30, 41, 59)
  for (const lines of termParagraphLines) {
    doc.text(lines, 18, contentY, { lineHeightFactor: 1.35 })
    contentY += lines.length * paragraphLineHeight + 4
  }
  const boxY = 43 + termHeight + 10
  const col = (pageWidth - 28) / 3

  const fields = [
    { label: "Colaborador", value: data.employeeName },
    { label: "CPF", value: data.employeeCpf },
    { label: "Cargo / Função", value: data.employeeRole },
    { label: "Setor / Depto.", value: data.employeeDepartment },
    { label: "Canteiro / Unidade", value: data.workplaceName },
    { label: "Data de Admissão", value: data.admissionDate },
  ]

  let fieldsY = boxY
  for (let row = 0; row < 2; row++) {
    let rowHeight = 17
    fields.slice(row * 3, row * 3 + 3).forEach((field, index) => {
      const x = 14 + index * col
      doc.setFont("helvetica", "bold")
      doc.setFontSize(7)
      doc.setTextColor(100, 116, 139)
      doc.text(field.label.toUpperCase(), x, fieldsY)
      doc.setFontSize(9)
      doc.setTextColor(30, 41, 59)
      const lines = doc.splitTextToSize(normalizeLegacyPdfText(field.value) || "-", col - 4) as string[]
      doc.text(lines, x, fieldsY + 5)
      rowHeight = Math.max(rowHeight, 9 + lines.length * 4)
    })
    fieldsY += rowHeight
  }

  const itemsWithSigs = await Promise.all(
    data.items.map(async (item) => {
      let signatureBase64 = item.signatureBase64
      let photoBase64 = item.photoBase64

      if (item.signatureUrl) {
        signatureBase64 = await fetchImageDataUrl(item.signatureUrl, {
          required: true,
          label: "a assinatura da entrega",
        }) || undefined
      }

      if (item.photoEvidenceUrl) {
        photoBase64 = await fetchImageDataUrl(item.photoEvidenceUrl, {
          required: true,
          label: "a evidencia fotografica da entrega",
        }) || undefined
      }

      if (signatureBase64 || photoBase64) return { ...item, signatureBase64, photoBase64 }
      return item
    })
  )

  const tableY = fieldsY + 4
  autoTable(doc, {
    startY: tableY,
    head: [["Data", "EPI", "Nº C.A.", "Qtd", "Motivo", "Status", "Devolução", "Assinatura"]],
    body: itemsWithSigs.map(item => [
      item.deliveryDate,
      normalizeLegacyPdfText(item.ppeName),
      item.caNr,
      item.quantity,
      normalizeLegacyPdfText(item.reason),
      item.returnedAt ? "Devolvido" : item.isExpired ? "Troca Pendente" : "Em uso",
      item.returnedAt ? format(new Date(item.returnedAt), "dd/MM/yyyy") : "-",
      item.authMethod === "fingerprint" ? `Impressão digital\n${item.fingerprintEvidenceCode || "Evidência indisponível"}` : "",
    ]),
    styles: {
      fontSize: 7,
      cellPadding: { top: 6, right: 3, bottom: 6, left: 3 },
      font: "helvetica",
      textColor: [30, 41, 59],
      minCellHeight: 12,
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [51, 65, 85],
      fontStyle: "bold",
      fontSize: 6.5,
      halign: "center",
    },
    alternateRowStyles: { fillColor: [250, 251, 253] },
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
        if (item?.authMethod === "fingerprint") return
        const cell = hookData.cell
        const maxW = cell.width - 4
        const maxH = cell.height - 4
        const x = cell.x + 2
        const y = cell.y + 2

        if (!item?.signatureBase64 && !item?.photoBase64) {
          drawSignatureCellLine(doc, cell)
          return
        }

        try {
          const drawImageFit = (imageBase64: string, areaX: number, areaY: number, areaW: number, areaH: number) => {
            const imgProps = doc.getImageProperties(imageBase64)
            const ratio = imgProps.width / imgProps.height
            let drawW = areaW
            let drawH = areaW / ratio
            if (drawH > areaH) {
              drawH = areaH
              drawW = areaH * ratio
            }
            const dx = areaX + (areaW - drawW) / 2
            const dy = areaY + (areaH - drawH) / 2
            const fmt = imageBase64.startsWith('data:image/png') ? 'PNG' : 'JPEG'
            doc.addImage(imageBase64, fmt, dx, dy, drawW, drawH)
          }

          if (item.authMethod === 'manual_facial' && item.photoBase64 && item.signatureBase64) {
            const photoW = Math.min(10, maxW * 0.34)
            drawImageFit(item.photoBase64, x, y, photoW, maxH)
            drawImageFit(item.signatureBase64, x + photoW + 2, y, maxW - photoW - 2, maxH)
          } else if (item.signatureBase64) {
            drawImageFit(item.signatureBase64, x, y, maxW, maxH)
          } else if (item.photoBase64) {
            drawImageFit(item.photoBase64, x, y, maxW, maxH)
          }
        } catch { /* skip */ }
      }
    },
    margin: { left: 14, right: 14, top: 46, bottom: 36 },
    theme: "striped",
    rowPageBreak: "avoid",
    didDrawPage: () => {
      addPageHeader(doc, "FICHA DE CONTROLE DE EPI - NR-06", "Documento de Prontuário Individual do Colaborador")
    },
  })

  // @ts-expect-error - jsPDF-autotable adds lastAutoTable to doc
  let finalY = doc.lastAutoTable?.finalY || 200
  finalY += 12

  if (data.tstSigner) {
    const tst = data.tstSigner
    const blockWidth = pageWidth - 28
    const blockX = (pageWidth - blockWidth) / 2
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    const signerNameLines = doc.splitTextToSize(tst.name.toUpperCase(), blockWidth - 33) as string[]
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    const signerRoleLines = doc.splitTextToSize(tst.role, blockWidth - 33) as string[]
    const blockHeight = Math.max(50, 44 + signerNameLines.length * 4 + signerRoleLines.length * 3)
    if (finalY + blockHeight > pageHeight - 36) {
      doc.addPage()
      addPageHeader(doc, "FICHA DE CONTROLE DE EPI - NR-06", "Documento de Prontuário Individual do Colaborador")
      finalY = 48
    }
    const blockY = finalY
    const contentX = blockX + 16
    const contentWidth = blockWidth - 32
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.25)
    doc.roundedRect(blockX, blockY, blockWidth, blockHeight, 2, 2)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.setTextColor(71, 85, 105)
    doc.text("ASSINATURA DO RESPONSÁVEL TÉCNICO", contentX, blockY + 7)

    try {
      const imgProps = doc.getImageProperties(tst.signatureBase64)
      const ratio = imgProps.width / imgProps.height
      if (tst.authMethod === 'manual_facial' && tst.photoBase64) {
        const photoSize = 18
        doc.addImage(tst.photoBase64, 'JPEG', blockX + 16, blockY + 11, photoSize, photoSize)
        const drawH = 12
        let drawW = drawH * ratio
        const sigAreaW = contentWidth - photoSize - 8
        if (drawW > sigAreaW) {
          drawW = sigAreaW
        }
        const sigX = blockX + 16 + photoSize + 8 + (sigAreaW - drawW) / 2
        const sigY = blockY + 15
        const fmt = tst.signatureBase64.startsWith('data:image/png') ? 'PNG' : 'JPEG'
        doc.addImage(tst.signatureBase64, fmt, sigX, sigY, drawW, drawH)
      } else {
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
      }
    } catch { /* skip */ }

    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.3)
    doc.line(contentX, blockY + 34, contentX + contentWidth, blockY + 34)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(30, 41, 59)
    doc.text(signerNameLines, contentX, blockY + 40, { lineHeightFactor: 1.33 })

    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(102, 102, 102)
    doc.text(signerRoleLines, contentX, blockY + 42 + signerNameLines.length * 4, { lineHeightFactor: 1.2 })

    finalY += blockHeight + 6
  }

  addDocumentFooters(doc, "Prontuário individual de EPI • Evidências conforme modalidade informada")

  return doc.output("blob")
}

export interface ReportPDFData {
  stats: { label: string; value: string; change: string }[]
  deliveries: DeliveryWithRelations[]
  periodTitle?: string
  thirdPartySummary?: { name: string; value: number; deliveries: number; items: number }[]
}

export function generateGeneralReportPDF(data: ReportPDFData): Blob {
  refreshPdfBrand()
  const doc = new jsPDF({ orientation: "landscape", format: "a4" })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const mx = 14
  const brandColor = [r, g, b] as [number, number, number]
  const ink = [15, 23, 42] as [number, number, number]
  const muted = [100, 116, 139] as [number, number, number]
  const border = [226, 232, 240] as [number, number, number]
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

  const drawContinuationHeader = () => {
    if (doc.getCurrentPageInfo().pageNumber > 1) addPageHeader(doc, "RELATÓRIO DE CONFORMIDADE E CUSTOS", data.periodTitle || "Período geral")
  }
  addReportHeader(doc, "RELATÓRIO DE CONFORMIDADE E CUSTOS", "Indicadores operacionais, rastreabilidade de entregas e leitura executiva do período", data.periodTitle || "Período geral")

  const cardY = 58
  const cardW = (pw - mx * 2 - 12) / 4
  const cardColors: [number, number, number][] = [
    brandColor,
    [5, 150, 105],
    [217, 119, 6],
    [37, 99, 235],
  ]
  data.stats.slice(0, 4).forEach((stat, i) => {
    const x = mx + i * (cardW + 4)
    const color = cardColors[i] || brandColor
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(x, cardY, cardW, 24, 3, 3, "F")
    doc.setDrawColor(...border)
    doc.roundedRect(x, cardY, cardW, 24, 3, 3, "S")
    doc.setFillColor(...color)
    doc.rect(x, cardY, 3, 24, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.setTextColor(...ink)
    doc.text(stat.value, x + 8, cardY + 12)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.2)
    doc.setTextColor(...muted)
    doc.text(stat.label.substring(0, 26).toUpperCase(), x + 8, cardY + 18)
    doc.setFontSize(6.7)
    doc.setTextColor(...color)
    doc.text(stat.change.substring(0, 24), x + cardW - 5, cardY + 12, { align: "right" })
  })

  const summaryY = 90
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(mx, summaryY, pw - mx * 2, 17, 3, 3, "F")
  doc.setDrawColor(...border)
  doc.roundedRect(mx, summaryY, pw - mx * 2, 17, 3, 3, "S")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8.5)
  doc.setTextColor(...ink)
  doc.text("Resumo operacional", mx + 7, summaryY + 7)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(...muted)
  doc.text(`${data.deliveries.length} entrega(s) no conjunto analisado`, mx + 7, summaryY + 13)
  doc.text("Tabela limitada aos 50 registros mais recentes para leitura gerencial.", pw - mx - 7, summaryY + 13, { align: "right" })

  let tableStartY = 123
  if (data.thirdPartySummary && data.thirdPartySummary.length > 0) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(...ink)
    doc.text("Valores por terceiro", mx, 119)

    autoTable(doc, {
      startY: 123,
      head: [["Terceiro", "Registros", "Itens", "Total para cobrança"]],
      body: data.thirdPartySummary.map((item) => [
        item.name,
        String(item.deliveries),
        String(item.items),
        currency.format(item.value),
      ]),
      headStyles: { fillColor: brandColor, fontStyle: "bold", fontSize: 7.4, cellPadding: 2.8, textColor: 255 },
      bodyStyles: { fontSize: 7.2, cellPadding: 2.6, textColor: ink },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: {
        0: { cellWidth: 128, fontStyle: "bold" },
        1: { cellWidth: 34, halign: "center" },
        2: { cellWidth: 34, halign: "center" },
        3: { cellWidth: 73, halign: "right", fontStyle: "bold" },
      },
      margin: { left: mx, right: mx, top: 46, bottom: 22 },
      rowPageBreak: "avoid",
      theme: "grid",
      styles: { lineColor: [226, 232, 240], lineWidth: 0.25, overflow: "linebreak" },
      didDrawPage: () => {
        drawContinuationHeader()
      },
    })
    tableStartY = ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 123) + 12
  }

  if (tableStartY > ph - 36) {
    doc.addPage()
    drawContinuationHeader()
    tableStartY = 52
  }
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(...ink)
  doc.text("Historico recente de transacoes", mx, tableStartY - 4)

  const recentDeliveries = data.deliveries.slice(0, 50)

  autoTable(doc, {
    startY: tableStartY,
    head: [["Data", "Colaborador", "EPI (C.A.)", "Qtd", "Custo Unit.", "Total", "Tomador", "Local"]],
    body: recentDeliveries.length > 0 ? recentDeliveries.map(d => {
      const quantity = Number(d.quantity || 0)
      const unitCost = Number(d.ppe?.cost || 0)
      const thirdPartyName = d.third_party_name || (d.third_party_id ? d.third_party_id.slice(0, 8) : "Proprio")
      return [
        `${formatDeliveryDate(d.delivery_date)} ${formatDeliveryTime(d.delivery_date)}`,
        d.employee?.full_name || 'N/A',
        `${d.ppe?.name || 'N/A'} (${d.ppe?.ca_number || 'N/A'})`,
        String(d.quantity),
        currency.format(unitCost),
        currency.format(quantity * unitCost),
        thirdPartyName,
        d.workplace?.name || 'Sede'
      ]
    }) : [["-", "Nenhuma transacao encontrada", "-", "-", "-", "-", "-", "-"]],
    headStyles: { fillColor: [15, 23, 42], fontStyle: "bold", fontSize: 7.4, cellPadding: 3.2, textColor: 255, halign: "center" },
    bodyStyles: { fontSize: 7, cellPadding: { top: 2.8, right: 3, bottom: 2.8, left: 3 }, textColor: ink },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: 25, halign: "center" },
      1: { cellWidth: 42, fontStyle: "bold" },
      2: { cellWidth: 50 },
      3: { cellWidth: 12, halign: "center", fontStyle: "bold" },
      4: { cellWidth: 22, halign: "right" },
      5: { cellWidth: 22, halign: "right", fontStyle: "bold" },
      6: { cellWidth: 36 },
      7: { cellWidth: 60 },
    },
    margin: { left: mx, right: mx, top: 46, bottom: 22 },
    rowPageBreak: "avoid",
    theme: "grid",
    styles: { lineColor: [226, 232, 240], lineWidth: 0.25, overflow: "linebreak" },
    didDrawPage: () => {
      drawContinuationHeader()
    },
  })

  addDocumentFooters(doc, "Relatório gerencial de conformidade e custos")
  return doc.output("blob")
}

export interface TrainingCertificateData {
  employeeName: string
  employeeCpf: string
  trainingName: string
  completionDate: string
  expiryDate: string
  instructorName?: string
  instructorRole?: string
  signatureBase64?: string
  photoBase64?: string
  instructorPhotoBase64?: string
  instructorSignatureBase64?: string
  instructorBlankSignature?: boolean
  participantSignatureBase64?: string
  participantPhotoBase64?: string
  participantBlankSignature?: boolean
  participantAuthMethod?: AuthMethod
  programContent?: string[]
  validationCode?: string
}

export async function generateTrainingCertificate(data: TrainingCertificateData): Promise<Blob> {
  refreshPdfBrand()
  const doc = new jsPDF({ orientation: "landscape", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const centerX = pageWidth / 2

  const drawBorders = () => {
    doc.setDrawColor(r, g, b)
    doc.setLineWidth(2.1)
    doc.rect(10, 10, pageWidth - 20, pageHeight - 20)
    doc.setLineWidth(0.5)
    doc.rect(13.5, 13.5, pageWidth - 27, pageHeight - 27)
  }

  doc.setFillColor(255, 255, 255)
  doc.rect(0, 0, pageWidth, pageHeight, "F")

  drawBorders()

  const logoBase64 = getPdfLogoDataUrl()
  const marginX = 25

  if (logoBase64) {
    try {
      addImageContained(doc, logoBase64, marginX, 20, 48, 36, "left")
    } catch { }
  }

  doc.setFont("times", "bold")
  doc.setFontSize(28)
  doc.setTextColor(26, 26, 46)
  doc.text("CERTIFICADO DE CONCLUSÃO", centerX, 40, { align: "center" })

  doc.setDrawColor(r, g, b)
  doc.setLineWidth(0.7)
  const lineW = 77
  doc.line(centerX - lineW/2, 45, centerX + lineW/2, 45)

  doc.setFont("helvetica", "italic")
  doc.setFontSize(12)
  doc.setTextColor(85, 85, 85)
  doc.text("Certificamos para os devidos fins que", centerX, 70, { align: "center" })

  doc.setFont("times", "bold")
  doc.setFontSize(24)
  doc.setTextColor(r, g, b)
  doc.text(data.employeeName.toUpperCase(), centerX, 85, { align: "center" })

  doc.setFont("helvetica", "normal")
  doc.setFontSize(11)
  doc.setTextColor(68, 68, 68)
  doc.text(`Portador(a) do CPF: ${data.employeeCpf}`, centerX, 95, { align: "center" })

  doc.setDrawColor(r, g, b)
  doc.setLineWidth(0.5)
  doc.line(centerX - 12, 103, centerX - 3, 103)
  doc.setFillColor(r, g, b)
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

  const workload = getTrainingWorkloadRule(data.trainingName)

  const completionText = format(new Date(data.completionDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
  const validity = calculateTrainingValidity(data.trainingName, data.completionDate)
  const validUntilText = validity.hasFixedExpiry
    ? format(new Date(data.expiryDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
    : "sem validade fixa geral"
  const validityLabel = validity.hasFixedExpiry ? `Válido até: ${validUntilText}` : `Validade: ${validUntilText}`

  doc.setFont("helvetica", "normal")
  doc.setFontSize(11)
  doc.setTextColor(68, 68, 68)
  doc.text(`Realizado em: ${completionText}  |  Carga Horária: ${workload.label}  |  ${validityLabel}`, centerX, 137, { align: "center" })

  const footerY = 160

  const code = data.validationCode || generateAuditCode(`CERT-${format(new Date(data.completionDate), "yyyy")}`, 10)
  const validationUrl = `https://app.safeepi.com.br/validar/${code}`

  try {
    const qrDataUrl = await QRCode.toDataURL(validationUrl, { width: 150, margin: 1 })
    doc.addImage(qrDataUrl, 'PNG', marginX, footerY, 25, 25)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(119, 119, 119)
    doc.text(`Autenticação:`, marginX + 12.5, footerY + 28, { align: "center" })
    doc.setFontSize(5.5)
    doc.text(`app.safeepi.com.br`, marginX + 12.5, footerY + 31, { align: "center" })
    doc.text(`/validar/${code}`, marginX + 12.5, footerY + 33.5, { align: "center" })
  } catch {}

  const participantSignature = data.participantSignatureBase64 || data.signatureBase64
  const participantPhoto = data.participantPhotoBase64
  if (participantSignature || participantPhoto || data.participantBlankSignature) {
    const sigLineW = 100
    const sigY = footerY + 15
    const hasSignature = Boolean(participantSignature)
    const hasPhoto = Boolean(participantPhoto)
    const signatureCenterX = hasSignature && hasPhoto ? centerX - 22 : centerX

    doc.setDrawColor(r, g, b)
    doc.setLineWidth(0.5)
    const lineWForEvidence = hasPhoto ? 72 : sigLineW
    doc.line(signatureCenterX - lineWForEvidence/2, sigY, signatureCenterX + lineWForEvidence/2, sigY)

    if (participantSignature && hasSignature) {
      try {
        const imgProps = doc.getImageProperties(participantSignature)
        const ratio = imgProps.width / imgProps.height
        let drawH = 15
        let drawW = drawH * ratio
        const maxW = hasPhoto ? 72 : sigLineW
        if (drawW > maxW) {
          drawW = maxW
          drawH = drawW / ratio
        }
        doc.addImage(participantSignature, "PNG", signatureCenterX - drawW/2, sigY - drawH - 1, drawW, drawH)
      } catch {}
    }

    if (participantPhoto && hasPhoto) {
      const evidencePhotoW = 20
      const evidencePhotoH = 24
      const evidencePhotoX = centerX + 24
      const evidencePhotoY = sigY - evidencePhotoH - 2
      doc.roundedRect(evidencePhotoX, evidencePhotoY, evidencePhotoW, evidencePhotoH, 2, 2, "S")
      try {
        doc.addImage(participantPhoto, "JPEG", evidencePhotoX + 1, evidencePhotoY + 1, evidencePhotoW - 2, evidencePhotoH - 2)
      } catch {}
      doc.setFont("helvetica", "normal")
      doc.setFontSize(7)
      doc.setTextColor(119, 119, 119)
      doc.text("Foto", evidencePhotoX + evidencePhotoW / 2, sigY + 5, { align: "center" })
    }

    doc.setFont("helvetica", "bold")
    doc.setFontSize(11)
    doc.setTextColor(85, 85, 85)
    doc.text(data.employeeName.toUpperCase(), signatureCenterX, sigY + 5, { align: "center" })

    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.text("Colaborador treinado", signatureCenterX, sigY + 10, { align: "center" })
  }

  const rightX = pageWidth - marginX
  doc.setFont("helvetica", "italic")
  doc.setFontSize(8)
  doc.setTextColor(136, 136, 136)
  const emitDate = format(new Date(), "dd/MM/yyyy")
  const emitTime = format(new Date(), "HH:mm")
  doc.text(`Documento emitido digitalmente em ${emitDate} às ${emitTime}`, rightX, footerY + 18, { align: "right" })

  doc.setFont("helvetica", "normal")
  doc.text("via Sistema SESMT Digital", rightX, footerY + 22, { align: "right" })

  doc.setFont("helvetica", "bold")
  doc.text(`Código: ${code}`, rightX, footerY + 26, { align: "right" })

  doc.addPage()
  drawBorders()

  if (logoBase64) {
    try {
      addImageContained(doc, logoBase64, marginX, 20, 35, 26, "left")
    } catch { }
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.setTextColor(26, 26, 46)
  doc.text("CONTEÚDO PROGRAMÁTICO", centerX, 30, { align: "center" })

  doc.setFont("helvetica", "italic")
  doc.setFontSize(14)
  doc.setTextColor(r, g, b)
  doc.text(data.trainingName.toUpperCase(), centerX, 38, { align: "center" })

  const content = data.programContent && data.programContent.length > 0
    ? data.programContent
    : [
        "1. Normas e regulamentos de segurança aplicáveis à atividade.",
        "2. Identificação, avaliação e controle de riscos e perigos.",
        "3. Procedimentos operacionais padrão (POP) e Permissão de Trabalho.",
        "4. Seleção, inspeção, uso correto e guarda de EPIs e EPCs.",
        "5. Primeiros socorros, resgate e ações de emergência.",
        "6. Direitos, deveres e responsabilidades do empregador e empregado.",
        "7. Prevenção de acidentes e doenças ocupacionais.",
        "8. Sinalização de segurança e isolamento de áreas."
      ]

  const tableData = []
  for (let i = 0; i < content.length; i += 2) {
    tableData.push([
      content[i] ? `   ${content[i]}` : "",
      content[i+1] ? `   ${content[i+1]}` : ""
    ])
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
      fillColor: [250, 250, 250]
    },
    columnStyles: {
      0: { cellWidth: (pageWidth - 2 * marginX) / 2 },
      1: { cellWidth: (pageWidth - 2 * marginX) / 2 }
    },
    margin: { left: marginX, right: marginX },
    didDrawCell: (hookData) => {
      if (hookData.section === 'body' && hookData.cell.raw && typeof hookData.cell.raw === 'string' && hookData.cell.raw.trim().length > 0) {
        hookData.doc.setFillColor(r, g, b)
        hookData.doc.circle(hookData.cell.x + 4, hookData.cell.y + hookData.cell.height/2, 1.2, "F")
      }
    }
  })

  if (data.instructorSignatureBase64 || data.instructorBlankSignature) {
    const signY = 138
    const signCenterX = centerX
    const signLineW = 90

    doc.setDrawColor(r, g, b)
    doc.setLineWidth(0.5)
    doc.line(signCenterX - signLineW / 2, signY, signCenterX + signLineW / 2, signY)

    if (data.instructorSignatureBase64) {
      try {
        const imgProps = doc.getImageProperties(data.instructorSignatureBase64)
        const ratio = imgProps.width / imgProps.height
        let drawH = 16
        let drawW = drawH * ratio
        if (drawW > signLineW) {
          drawW = signLineW
          drawH = drawW / ratio
        }
        const fmt = data.instructorSignatureBase64.startsWith("data:image/png") ? "PNG" : "JPEG"
        doc.addImage(data.instructorSignatureBase64, fmt, signCenterX - drawW / 2, signY - drawH - 1, drawW, drawH)
      } catch {}
    }

    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(85, 85, 85)
    doc.text((data.instructorName || "Instrutor").toUpperCase(), signCenterX, signY + 5, { align: "center" })
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text(data.instructorRole || "Instrutor", signCenterX, signY + 10, { align: "center" })
    doc.setFontSize(8)
    doc.setTextColor(119, 119, 119)
    doc.text("Assinatura do instrutor", signCenterX, signY + 15, { align: "center" })
  }

  const versoFooterY = pageHeight - 45

  doc.setFillColor(245, 245, 245)
  doc.rect(marginX, versoFooterY, pageWidth - 2 * marginX - 40, 20, "F")

  doc.setDrawColor(r, g, b)
  doc.setLineWidth(1.4)
  doc.line(marginX, versoFooterY, marginX, versoFooterY + 20)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(85, 85, 85)
  const nrNumberMatch = data.trainingName.match(/NR-?(\d+)/i)
  const nrNumber = nrNumberMatch ? nrNumberMatch[1] : "06"
  const legalText = `Este certificado é válido conforme NR-${nrNumber} e demais legislações vigentes.\nEmitido pelo SESMT da SafeEPI.`
  doc.text(legalText, marginX + 5, versoFooterY + 8)

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
  technicianName?: string
  technicianRole?: string
  technicianSignatureBase64?: string
}

export interface EmployeesReportData {
  employees: Employee[]
  workplaces?: { id: string; name: string }[]
  periodLabel?: string
}

export function generateEmployeesReportPDF(data: EmployeesReportData): Blob {
  refreshPdfBrand()
  const doc = new jsPDF({ orientation: "landscape", format: "a4" })
  const pw = doc.internal.pageSize.getWidth()
  const mx = 14
  const brandColor = [r, g, b] as [number, number, number]
  const ink = [15, 23, 42] as [number, number, number]
  const muted = [100, 116, 139] as [number, number, number]
  const border = [226, 232, 240] as [number, number, number]
  const workplaceName = (id?: string | null) => data.workplaces?.find(w => w.id === id)?.name || "Administrativo"

  const drawContinuationHeader = () => {
    if (doc.getCurrentPageInfo().pageNumber > 1) addPageHeader(doc, "RELATÓRIO DE COLABORADORES", data.periodLabel || "Equipe completa")
  }
  addReportHeader(doc, "RELATÓRIO DE COLABORADORES", "Quadro funcional, lotação, status de vínculo e foto cadastral", data.periodLabel || "Equipe completa")

  const activeCount = data.employees.filter(e => e.active).length
  const inactiveCount = data.employees.length - activeCount
  const photoCount = data.employees.filter(e => e.photo_url).length
  const photoPendingCount = data.employees.length - photoCount
  const kpis = [
    { label: "Total", value: data.employees.length, color: brandColor },
    { label: "Ativos", value: activeCount, color: [5, 150, 105] as [number, number, number] },
    { label: "Inativos", value: inactiveCount, color: [217, 119, 6] as [number, number, number] },
    { label: "Com foto", value: photoCount, color: [37, 99, 235] as [number, number, number] },
    { label: "Sem foto", value: photoPendingCount, color: [220, 38, 38] as [number, number, number] },
  ]
  const cardY = 58
  const cardW = (pw - mx * 2 - 16) / 5
  kpis.forEach((kpi, index) => {
    const x = mx + index * (cardW + 4)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(x, cardY, cardW, 23, 3, 3, "F")
    doc.setDrawColor(...border)
    doc.roundedRect(x, cardY, cardW, 23, 3, 3, "S")
    doc.setFillColor(...kpi.color)
    doc.rect(x, cardY, 3, 23, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(15.5)
    doc.setTextColor(...kpi.color)
    doc.text(String(kpi.value), x + 8, cardY + 13)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.2)
    doc.setTextColor(...muted)
    doc.text(kpi.label.toUpperCase(), x + 8, cardY + 19)
  })

  const summaryY = 88
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(mx, summaryY, pw - mx * 2, 19, 3, 3, "F")
  doc.setDrawColor(...border)
  doc.roundedRect(mx, summaryY, pw - mx * 2, 19, 3, 3, "S")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8.5)
  doc.setTextColor(...ink)
  doc.text("Resumo operacional", mx + 7, summaryY + 8)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(...muted)
  doc.text(`${activeCount} ativo(s) e ${inactiveCount} inativo(s) no conjunto filtrado`, mx + 7, summaryY + 15)
  doc.text(`${photoPendingCount} cadastro(s) sem foto`, mx + 90, summaryY + 15)
  doc.text("Uso recomendado: conferencia gerencial, TST e auditoria interna.", pw - mx - 7, summaryY + 15, { align: "right" })

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(...ink)
  doc.text("Prontuario de colaboradores", mx, 119)

  autoTable(doc, {
    startY: 123,
    head: [["Nome", "CPF", "Cargo", "Setor", "Obra", "Admissao", "Demissao", "Status", "Foto cadastral"]],
    body: data.employees.map(emp => [
      emp.full_name,
      emp.cpf,
      emp.job_title || "-",
      emp.department || "-",
      workplaceName(emp.workplace_id),
      emp.admission_date ? format(new Date(`${emp.admission_date}T12:00:00`), "dd/MM/yyyy") : "-",
      emp.termination_date ? format(new Date(`${emp.termination_date}T12:00:00`), "dd/MM/yyyy") : "-",
      emp.active ? "ATIVO" : "INATIVO",
      emp.photo_url ? "CADASTRADA" : "PENDENTE",
    ]),
    headStyles: { fillColor: [15, 23, 42], fontStyle: "bold", fontSize: 7.2, cellPadding: 3.1, textColor: 255, halign: "center" },
    bodyStyles: { fontSize: 6.8, cellPadding: { top: 2.6, right: 2.6, bottom: 2.6, left: 2.6 }, textColor: ink },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: 46, fontStyle: "bold" },
      1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 45 },
      3: { cellWidth: 29 },
      4: { cellWidth: 37 },
      5: { cellWidth: 21, halign: "center" },
      6: { cellWidth: 21, halign: "center" },
      7: { cellWidth: 20, halign: "center", fontStyle: "bold" },
      8: { cellWidth: 25, halign: "center", fontStyle: "bold" },
    },
    margin: { left: mx, right: mx, top: 46, bottom: 22 },
    rowPageBreak: "avoid",
    theme: "grid",
    styles: { lineColor: [226, 232, 240], lineWidth: 0.25, overflow: "linebreak" },
    didParseCell: (hookData) => {
      if (hookData.section !== "body") return
      if (hookData.column.index === 7) {
        const active = String(hookData.cell.raw || "") === "ATIVO"
        hookData.cell.styles.textColor = active ? [4, 120, 87] : [180, 83, 9]
        hookData.cell.styles.fillColor = active ? [236, 253, 245] : [255, 251, 235]
      }
      if (hookData.column.index === 8) {
        const ok = String(hookData.cell.raw || "") === "CADASTRADA"
        hookData.cell.styles.textColor = ok ? [37, 99, 235] : [185, 28, 28]
        hookData.cell.styles.fillColor = ok ? [239, 246, 255] : [254, 242, 242]
      }
    },
    didDrawPage: () => {
      drawContinuationHeader()
    },
  })

  addDocumentFooters(doc, "Relatório de colaboradores")
  return doc.output("blob")
}

export interface PpeCatalogReportData {
  ppes: PPE[]
  filterLabel?: string
}

export function generatePpeCatalogReportPDF(data: PpeCatalogReportData): Blob {
  refreshPdfBrand()
  const doc = new jsPDF({ orientation: "landscape", format: "a4" })
  const pw = doc.internal.pageSize.getWidth()
  const mx = 14
  const brandColor = [r, g, b] as [number, number, number]
  const ink = [15, 23, 42] as [number, number, number]
  const muted = [100, 116, 139] as [number, number, number]
  const border = [226, 232, 240] as [number, number, number]
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
  const getStatus = (ppe: PPE) => {
    const days = getDaysUntilDateOnly(ppe.ca_expiry_date)
    if (days < 0) return { label: "CA VENCIDO", rank: 0, color: [185, 28, 28] as [number, number, number], fill: [254, 242, 242] as [number, number, number] }
    if (days <= 90) return { label: `VENCE EM ${days}D`, rank: 1, color: [180, 83, 9] as [number, number, number], fill: [255, 251, 235] as [number, number, number] }
    return { label: "REGULAR", rank: 2, color: [4, 120, 87] as [number, number, number], fill: [236, 253, 245] as [number, number, number] }
  }
  const ppes = [...data.ppes].sort((a, b) => {
    const statusA = getStatus(a)
    const statusB = getStatus(b)
    if (statusA.rank !== statusB.rank) return statusA.rank - statusB.rank
    const stockA = Number(a.current_stock || 0) <= 5 ? 0 : 1
    const stockB = Number(b.current_stock || 0) <= 5 ? 0 : 1
    if (stockA !== stockB) return stockA - stockB
    return a.name.localeCompare(b.name, "pt-BR")
  })
  const totalStock = ppes.reduce((acc, ppe) => acc + Number(ppe.current_stock || 0), 0)
  const totalValue = ppes.reduce((acc, ppe) => acc + Number(ppe.current_stock || 0) * Number(ppe.cost || 0), 0)
  const expiredCount = ppes.filter((ppe) => getStatus(ppe).rank === 0).length
  const expiringCount = ppes.filter((ppe) => getStatus(ppe).rank === 1).length
  const lowStockCount = ppes.filter((ppe) => Number(ppe.current_stock || 0) <= 5).length
  const regularCount = Math.max(0, ppes.length - expiredCount - expiringCount)

  const drawContinuationHeader = () => {
    if (doc.getCurrentPageInfo().pageNumber > 1) addPageHeader(doc, "RELATÓRIO TÉCNICO DE EPIS E CAS", data.filterLabel || "Catálogo ativo completo")
  }
  addReportHeader(doc, "RELATÓRIO TÉCNICO DE EPIS E CAS", "Validade dos CAs, saldo de estoque e custo estimado para gestão operacional", data.filterLabel || "Catálogo ativo completo")

  const kpis = [
    { label: "Itens catalogados", value: ppes.length, color: brandColor },
    { label: "CAs regulares", value: regularCount, color: [5, 150, 105] as [number, number, number] },
    { label: "CAs vencendo", value: expiringCount, color: [217, 119, 6] as [number, number, number] },
    { label: "CAs vencidos", value: expiredCount, color: [220, 38, 38] as [number, number, number] },
    { label: "Estoque baixo", value: lowStockCount, color: [37, 99, 235] as [number, number, number] }
  ]
  const cardY = 58
  const cardW = (pw - mx * 2 - 16) / 5
  kpis.forEach((kpi, index) => {
    const x = mx + index * (cardW + 4)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(x, cardY, cardW, 23, 3, 3, "F")
    doc.setDrawColor(...border)
    doc.roundedRect(x, cardY, cardW, 23, 3, 3, "S")
    doc.setFillColor(...kpi.color)
    doc.rect(x, cardY, 3, 23, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(15.5)
    doc.setTextColor(...kpi.color)
    doc.text(String(kpi.value), x + 8, cardY + 13)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.2)
    doc.setTextColor(...muted)
    doc.text(kpi.label.toUpperCase(), x + 8, cardY + 19)
  })

  const summaryY = 88
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(mx, summaryY, pw - mx * 2, 19, 3, 3, "F")
  doc.setDrawColor(...border)
  doc.roundedRect(mx, summaryY, pw - mx * 2, 19, 3, 3, "S")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(8.5)
  doc.setTextColor(...ink)
  doc.text("Resumo operacional", mx + 7, summaryY + 8)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(...muted)
  doc.text(`Saldo total: ${totalStock} unidade(s)`, mx + 7, summaryY + 15)
  doc.text(`Valor estimado em estoque: ${currency.format(totalValue)}`, mx + 70, summaryY + 15)
  doc.text(`Ordenacao: vencidos, vencendo, estoque baixo e ordem alfabetica`, pw - mx - 7, summaryY + 15, { align: "right" })

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(...ink)
  doc.text("Inventario tecnico", mx, 119)

  autoTable(doc, {
    startY: 123,
    head: [["Equipamento", "C.A.", "Validade", "Conformidade", "Saldo", "Custo Unit.", "Valor Estoque"]],
    body: ppes.map((ppe) => {
      const status = getStatus(ppe)
      const stock = Number(ppe.current_stock || 0)
      const cost = Number(ppe.cost || 0)

      return [
        ppe.name,
        ppe.ca_number || "N/A",
        formatDateOnly(ppe.ca_expiry_date),
        status.label,
        String(stock),
        currency.format(cost),
        currency.format(stock * cost),
      ]
    }),
    headStyles: { fillColor: [15, 23, 42], fontStyle: "bold", fontSize: 7.4, cellPadding: 3.2, textColor: 255, halign: "center" },
    bodyStyles: { fontSize: 7, cellPadding: { top: 2.8, right: 3, bottom: 2.8, left: 3 }, textColor: ink },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: 82, fontStyle: "bold" },
      1: { cellWidth: 24, halign: "center" },
      2: { cellWidth: 27, halign: "center" },
      3: { cellWidth: 36, halign: "center" },
      4: { cellWidth: 20, halign: "center", fontStyle: "bold" },
      5: { cellWidth: 34, halign: "right" },
      6: { cellWidth: 46, halign: "right", fontStyle: "bold" },
    },
    margin: { left: mx, right: mx, top: 46, bottom: 22 },
    rowPageBreak: "avoid",
    theme: "grid",
    styles: { lineColor: [226, 232, 240], lineWidth: 0.25, overflow: "linebreak" },
    didParseCell: (hookData) => {
      if (hookData.section !== "body") return
      if (hookData.column.index === 3) {
        const rowPpe = ppes[hookData.row.index]
        const status = getStatus(rowPpe)
        hookData.cell.styles.textColor = status.color
        hookData.cell.styles.fillColor = status.fill
        hookData.cell.styles.fontStyle = "bold"
      }
      if (hookData.column.index === 4 && Number(hookData.cell.raw || 0) <= 5) {
        hookData.cell.styles.textColor = [37, 99, 235]
        hookData.cell.styles.fillColor = [239, 246, 255]
      }
    },
    didDrawPage: () => {
      drawContinuationHeader()
    },
  })

  addDocumentFooters(doc, "Relatório técnico de EPIs e CAs")
  return doc.output("blob")
}

export interface InventoryStockReportData {
  ppes: PPE[]
  filterLabel?: string
}

export function generateInventoryStockReportPDF(data: InventoryStockReportData): Blob {
  refreshPdfBrand()
  const doc = new jsPDF({ orientation: "landscape", format: "a4" })
  const pw = doc.internal.pageSize.getWidth()
  const mx = 14
  const brandColor = [r, g, b] as [number, number, number]
  const ink = [15, 23, 42] as [number, number, number]
  const muted = [100, 116, 139] as [number, number, number]
  const border = [226, 232, 240] as [number, number, number]
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
  const ppes = [...data.ppes].sort((a, b) => {
    const stockA = Number(a.current_stock || 0)
    const stockB = Number(b.current_stock || 0)
    if ((stockA <= 5) !== (stockB <= 5)) return stockA <= 5 ? -1 : 1
    return a.name.localeCompare(b.name, "pt-BR")
  })
  const totalStock = ppes.reduce((acc, ppe) => acc + Number(ppe.current_stock || 0), 0)
  const totalValue = ppes.reduce((acc, ppe) => acc + Number(ppe.current_stock || 0) * Number(ppe.cost || 0), 0)
  const lowStockCount = ppes.filter((ppe) => Number(ppe.current_stock || 0) <= 5).length
  const zeroStockCount = ppes.filter((ppe) => Number(ppe.current_stock || 0) <= 0).length

  const drawContinuationHeader = () => {
    if (doc.getCurrentPageInfo().pageNumber > 1) addPageHeader(doc, "RELATÓRIO DE ESTOQUE", data.filterLabel || "Estoque atual")
  }
  addReportHeader(doc, "RELATÓRIO DE ESTOQUE", "Saldo físico atual, status de reposição e valor estimado em estoque", data.filterLabel || "Estoque atual")

  const kpis = [
    { label: "Itens listados", value: ppes.length, color: brandColor },
    { label: "Saldo total", value: totalStock, color: [5, 150, 105] as [number, number, number] },
    { label: "Estoque baixo", value: lowStockCount, color: [217, 119, 6] as [number, number, number] },
    { label: "Saldo zerado", value: zeroStockCount, color: [220, 38, 38] as [number, number, number] },
    { label: "Valor estimado", value: currency.format(totalValue), color: [15, 23, 42] as [number, number, number] },
  ]
  const cardY = 58
  const cardW = (pw - mx * 2 - 16) / 5
  kpis.forEach((kpi, index) => {
    const x = mx + index * (cardW + 4)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(x, cardY, cardW, 23, 3, 3, "F")
    doc.setDrawColor(...border)
    doc.roundedRect(x, cardY, cardW, 23, 3, 3, "S")
    doc.setFillColor(...kpi.color)
    doc.rect(x, cardY, 3, 23, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(index === 4 ? 11 : 15.5)
    doc.setTextColor(...kpi.color)
    doc.text(String(kpi.value), x + 8, cardY + 13)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.2)
    doc.setTextColor(...muted)
    doc.text(kpi.label.toUpperCase(), x + 8, cardY + 19)
  })

  autoTable(doc, {
    startY: 92,
    head: [["Equipamento", "C.A.", "Fabricante", "Saldo", "Status", "Custo Unit.", "Valor Estoque"]],
    body: ppes.map((ppe) => {
      const stock = Number(ppe.current_stock || 0)
      const cost = Number(ppe.cost || 0)
      return [
        ppe.name,
        ppe.ca_number || "N/A",
        ppe.manufacturer || "-",
        String(stock),
        stock <= 5 ? "ESTOQUE BAIXO" : "OK",
        currency.format(cost),
        currency.format(stock * cost),
      ]
    }),
    headStyles: { fillColor: [15, 23, 42], fontStyle: "bold", fontSize: 7.4, cellPadding: 3.2, textColor: 255, halign: "center" },
    bodyStyles: { fontSize: 7, cellPadding: { top: 2.8, right: 3, bottom: 2.8, left: 3 }, textColor: ink },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: 74, fontStyle: "bold" },
      1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 45 },
      3: { cellWidth: 20, halign: "center", fontStyle: "bold" },
      4: { cellWidth: 34, halign: "center", fontStyle: "bold" },
      5: { cellWidth: 32, halign: "right" },
      6: { cellWidth: 39, halign: "right", fontStyle: "bold" },
    },
    margin: { left: mx, right: mx, top: 46, bottom: 22 },
    rowPageBreak: "avoid",
    theme: "grid",
    styles: { lineColor: [226, 232, 240], lineWidth: 0.25, overflow: "linebreak" },
    didParseCell: (hookData) => {
      if (hookData.section !== "body") return
      if (hookData.column.index === 4) {
        const lowStock = String(hookData.cell.raw || "") === "ESTOQUE BAIXO"
        hookData.cell.styles.textColor = lowStock ? [185, 28, 28] : [4, 120, 87]
        hookData.cell.styles.fillColor = lowStock ? [254, 242, 242] : [236, 253, 245]
      }
      if (hookData.column.index === 3 && Number(hookData.cell.raw || 0) <= 5) {
        hookData.cell.styles.textColor = [185, 28, 28]
      }
    },
    didDrawPage: () => {
      drawContinuationHeader()
    },
  })

  addDocumentFooters(doc, "Relatório de estoque")
  return doc.output("blob")
}

function drawCard(doc: jsPDF, x: number, y: number, w: number, h: number, accentColor?: [number, number, number]) {
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.25)
  doc.roundedRect(x, y, w, h, 2, 2, "FD")
  if (accentColor) {
    doc.setFillColor(...accentColor)
    doc.rect(x + 5, y, w - 10, 0.8, "F")
  }
}

async function imageUrlToBase64(url?: string | null): Promise<string | null> {
  return fetchImageDataUrl(url)
}

export function generateMovementsSimplePDF(data: MovementsReportData): Blob {
  refreshPdfBrand()
  const doc = new jsPDF({ orientation: "portrait", format: "a4" })
  const pw = doc.internal.pageSize.getWidth()
  const mx = 14
  addReportHeader(doc, "RELATÓRIO DE MOVIMENTAÇÕES", "Entregas e devoluções de equipamentos no período selecionado", data.period)

  const cardY = 48
  const cardW = (pw - mx * 2 - 9) / 4
  const cardH = 28
  const kpis = [
    { label: "Entregas", value: String(data.stats.deliveries), color: [r, g, b] as [number, number, number] },
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
      formatDeliveryDate(m.delivery_date),
      m.employee?.full_name || "-",
      `${m.ppe?.name || "-"} (CA: ${m.ppe?.ca_number || "-"})`,
      String(m.quantity),
      m.returned_at ? "DEVOLUÇÃO" : "ENTREGA",
      m.workplace?.name || "Geral"
    ]),
    headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold", fontSize: 7, cellPadding: 3 },
    bodyStyles: { fontSize: 7.5, cellPadding: 3.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 22 },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 24, halign: "center" },
    },
    margin: { left: mx, right: mx, top: 46, bottom: 24 },
    rowPageBreak: "avoid",
    theme: "striped",
    styles: { lineColor: [226, 232, 240], lineWidth: 0.15, overflow: "linebreak" },
    didDrawPage: () => {
      if (doc.getCurrentPageInfo().pageNumber > 1) addPageHeader(doc, "RELATÓRIO DE MOVIMENTAÇÕES", data.period)
    },
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

  addDocumentFooters(doc, `Movimentações de EPI • ${data.movements.length} registros no conjunto`)
  return doc.output("blob")
}

export async function generateMovementsPresentationPDF(data: MovementsReportData): Promise<Blob> {
  refreshPdfBrand()
  const doc = new jsPDF({ orientation: "landscape", format: "a4" })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const signatureImages = new Map<string, string>()

  await Promise.all(data.movements.map(async (movement) => {
    const image = await imageUrlToBase64(movement.signature_url)
    if (image) signatureImages.set(movement.id, image)
  }))

  addReportHeader(doc, "RELATÓRIO DE MOVIMENTAÇÕES DE EPI", "Visão operacional do período e detalhamento dos registros", data.period)

  const kpiY = 60
  const kpiW = (pw - 36 - 15) / 4
  const kpiH = 32
  const kpis = [
    { label: "Total de Entregas", value: String(data.stats.deliveries), color: [r, g, b] as [number, number, number] },
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

  const chartsY = kpiY + kpiH + 8
  const chartsH = ph - chartsY - 18

  const leftW = (pw - 36 - 10) * 0.52
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
  const barAvailH = chartsH - 30
  const singleBarH = Math.min(barAvailH / Math.max(topEpis.length, 1), 12)
  const barAreaW = leftW - 84

  topEpis.forEach(([name, count], i) => {
    const y = barAreaY + i * singleBarH
    const filledW = (count / barMaxVal) * barAreaW
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(71, 85, 105)
    const truncName = name.length > 20 ? name.slice(0, 20) + "..." : name
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
    doc.text(String(count), Math.min(barX + filledW + 4, 18 + leftW - 12), y + singleBarH / 2)
  })

  const rightX = 18 + leftW + 10
  const rightW = pw - rightX - 18
  const topCardH = 46
  const bottomCardH = Math.max(34, chartsH - topCardH - 8)

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
    const stackBarH = 10
    const delivW = stackW * delivPct
    const retW = stackW * retPct
    if (delivW > 2) {
      doc.setFillColor(r, g, b)
      doc.roundedRect(rightX + 10, stackBarY, delivW, stackBarH, 2, 2, "F")
    }
    if (retW > 2) {
      doc.setFillColor(217, 119, 6)
      doc.roundedRect(rightX + 10 + delivW, stackBarY, retW, stackBarH, 2, 2, "F")
    }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.setTextColor(255, 255, 255)
    if (delivW > 20) doc.text(`${Math.round(delivPct * 100)}%`, rightX + 10 + delivW / 2, stackBarY + 7, { align: "center" })
    if (retW > 20) doc.text(`${Math.round(retPct * 100)}%`, rightX + 10 + delivW + retW / 2, stackBarY + 7, { align: "center" })

    const legY = stackBarY + stackBarH + 5
    const halfW = (rightW - 20) / 2
    doc.setFillColor(r, g, b)
    doc.roundedRect(rightX + 10, legY, 5, 5, 1, 1, "F")
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(30, 41, 59)
    doc.text(`Entregas: ${data.stats.deliveries}`, rightX + 18, legY + 4.2)
    doc.setFillColor(217, 119, 6)
    doc.roundedRect(rightX + 10 + halfW, legY, 5, 5, 1, 1, "F")
    doc.text(`Devoluções: ${data.stats.returns}`, rightX + 18 + halfW, legY + 4.2)
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
  const maxWpRows = Math.max(1, Math.floor((bottomCardH - 22) / 10))
  const topWp = Object.entries(wpCount).sort((a, b) => b[1] - a[1]).slice(0, Math.min(maxWpRows, 5))
  const wpMaxVal = topWp[0]?.[1] || 1
  const labelW = 50
  const wpBarW = rightW - labelW - 24

  topWp.forEach(([wp, count], i) => {
    const rowY = botY + 19 + i * 10
    const filledW = (count / wpMaxVal) * wpBarW
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(71, 85, 105)
    const wpLabel = wp.length > 14 ? wp.slice(0, 14) + "..." : wp
    doc.text(wpLabel, rightX + 8, rowY + 5.5)
    doc.setFillColor(241, 245, 249)
    doc.roundedRect(rightX + 8 + labelW, rowY, wpBarW, 8, 2, 2, "F")
    if (filledW > 0) {
      doc.setFillColor(r, g, b)
      doc.roundedRect(rightX + 8 + labelW, rowY, filledW, 8, 2, 2, "F")
    }
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.setTextColor(r, g, b)
    doc.text(String(count), rightX + rightW - 8, rowY + 5.5, { align: "right" })
  })

  doc.addPage()
  const detailHeader = () => addPageHeader(doc, "DETALHAMENTO DE MOVIMENTAÇÕES", `${data.period} • ${data.movements.length} registros`)
  detailHeader()

  autoTable(doc, {
    startY: 46,
    head: [["#", "Data", "Colaborador", "CPF", "EPI / CA", "Qtd", "Tipo", "Unidade", "Assinatura"]],
    body: data.movements.map((m, idx) => [
      String(idx + 1),
      `${formatDeliveryDate(m.delivery_date)} ${formatDeliveryTime(m.delivery_date)}`,
      m.employee?.full_name || "-",
      m.employee?.cpf || "-",
      `${m.ppe?.name || "-"} (CA: ${m.ppe?.ca_number || "-"})`,
      String(m.quantity),
      m.returned_at ? "DEVOLUÇÃO" : "ENTREGA",
      m.workplace?.name || "Geral",
      ""
    ]),
    headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold", fontSize: 7, cellPadding: 2.2, valign: "middle" },
    bodyStyles: { fontSize: 6.6, cellPadding: 2.2, valign: "middle", minCellHeight: 16 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 10, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 27 },
      2: { cellWidth: 56 },
      3: { cellWidth: 26 },
      4: { cellWidth: 64 },
      5: { cellWidth: 11, halign: "center" },
      6: { cellWidth: 22, halign: "center" },
      7: { cellWidth: 25 },
      8: { cellWidth: 28, halign: "center" },
    },
    margin: { left: 14, right: 14, top: 46, bottom: 24 },
    rowPageBreak: "avoid",
    theme: "striped",
    styles: { lineColor: [226, 232, 240], lineWidth: 0.15, overflow: "linebreak" },
    didDrawPage: () => { if (doc.getCurrentPageInfo().pageNumber > 2) detailHeader() },
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
    },
    didDrawCell: (hookData) => {
      if (hookData.section !== "body" || hookData.column.index !== 8) return
      const movement = data.movements[hookData.row.index]
      const image = movement ? signatureImages.get(movement.id) : null
      if (!image) {
        drawSignatureCellLine(doc, hookData.cell)
        return
      }

      try {
        const props = doc.getImageProperties(image)
        const maxW = hookData.cell.width - 4
        const maxH = hookData.cell.height - 2
        const ratio = Math.min(maxW / props.width, maxH / props.height)
        const drawW = props.width * ratio
        const drawH = props.height * ratio
        const x = hookData.cell.x + (hookData.cell.width - drawW) / 2
        const y = hookData.cell.y + (hookData.cell.height - drawH) / 2
        const fmt = image.startsWith("data:image/png") ? "PNG" : "JPEG"
        doc.addImage(image, fmt, x, y, drawW, drawH)
      } catch {}
    }
  })

  const finalY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 150
  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  const technicianNameLines = doc.splitTextToSize((data.technicianName || "Responsavel tecnico").toUpperCase(), 144) as string[]
  doc.setFont("helvetica", "normal")
  doc.setFontSize(6.5)
  const technicianRoleLines = doc.splitTextToSize(data.technicianRole || "Responsavel tecnico pelo relatorio", 144) as string[]
  const signatureBlockHeight = 42 + (technicianNameLines.length - 1) * 3.3 + (technicianRoleLines.length - 1) * 2.8
  let signatureTop = finalY + 12
  if (signatureTop + signatureBlockHeight > ph - 24) {
    doc.addPage()
    detailHeader()
    signatureTop = 49
  }
  const signY = signatureTop + 24
  if (data.technicianSignatureBase64) {
    try {
      const props = doc.getImageProperties(data.technicianSignatureBase64)
      const ratio = Math.min(62 / props.width, 18 / props.height)
      const drawW = props.width * ratio
      const drawH = props.height * ratio
      const fmt = data.technicianSignatureBase64.startsWith("data:image/png") ? "PNG" : "JPEG"
      doc.addImage(data.technicianSignatureBase64, fmt, pw / 2 - drawW / 2, signY - drawH - 2, drawW, drawH)
    } catch {}
  }
  drawManualSignatureLine(
    doc,
    pw / 2,
    signY,
    144,
    data.technicianName || "Responsavel tecnico",
    data.technicianRole || "Responsavel tecnico pelo relatorio",
    data.technicianSignatureBase64 ? "Assinatura digital registrada" : "Assinar manualmente sobre a linha"
  )

  addDocumentFooters(doc, `Movimentações de EPI • ${data.movements.length} registros no conjunto`)
  return doc.output("blob")
}
