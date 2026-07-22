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
type AuthMethod = 'manual' | 'facial' | 'manual_facial'

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

  doc.setFillColor(r, g, b)
  doc.rect(0, 0, pageWidth, 38, "F")

  doc.setFillColor(r + 30, g + 30, b + 30)
  doc.rect(0, 34, pageWidth, 4, "F")

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.setFont("helvetica", "bold")
  if (!addPdfLogo(doc, 14, 7, 24, 14)) {
    doc.text(getPdfCompanyName().toUpperCase(), 14, 13)
  }

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

function addFootersToEveryPage(doc: jsPDF, hash?: string, ip?: string) {
  const lastPage = doc.getNumberOfPages()
  for (let page = 1; page <= lastPage; page += 1) {
    doc.setPage(page)
    addPageFooter(doc, hash, ip)
  }
  doc.setPage(lastPage)
}

function normalizeLegacyPdfText(value: string | null | undefined) {
  const text = value || ""
  const replacements: Array<[string, string]> = [
    ["Ã§", "ç"], ["Ã£", "ã"], ["Ã¡", "á"], ["Ã ", "à"], ["Ã¢", "â"],
    ["Ã©", "é"], ["Ãª", "ê"], ["Ã­", "í"], ["Ã³", "ó"],
    ["Ã´", "ô"], ["Ãµ", "õ"], ["Ãº", "ú"], ["Ãƒ", "Ã"],
    ["Âº", "º"], ["Âª", "ª"], ["Â·", "·"],
    ["â€¢", "•"], ["â€“", "–"], ["â€”", "—"],
  ]

  return replacements.reduce((normalized, [broken, fixed]) => normalized.replaceAll(broken, fixed), text)
}

function fitSingleLineText(doc: jsPDF, value: string | null | undefined, maxWidth: number) {
  const text = normalizeLegacyPdfText(value) || "-"
  if (doc.getTextWidth(text) <= maxWidth) return text

  const suffix = "…"
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (doc.getTextWidth(`${text.slice(0, middle).trimEnd()}${suffix}`) <= maxWidth) low = middle
    else high = middle - 1
  }
  return `${text.slice(0, low).trimEnd()}${suffix}`
}

function infoRow(doc: jsPDF, label: string, value: string, x: number, y: number, maxWidth?: number) {
  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139)
  doc.text(label.toUpperCase(), x, y)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(30, 41, 59)
  doc.text(maxWidth ? fitSingleLineText(doc, value, maxWidth) : normalizeLegacyPdfText(value) || "-", x, y + 5)
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
  doc.text((signerName || "Responsavel pela assinatura").toUpperCase(), centerX, lineY + 5, { align: "center" })
  doc.setFont("helvetica", "normal")
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.text(role, centerX, lineY + 9, { align: "center" })
  doc.setFontSize(6)
  doc.setTextColor(148, 163, 184)
  doc.text(note, centerX, lineY + 13, { align: "center" })
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
  ipAddress?: string
  location?: string
  validationHash?: string
  deliveryDate?: string
}

export async function generateDeliveryPDF(data: DeliveryPDFData): Promise<Blob> {
  refreshPdfBrand()
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const hash = data.validationHash || generateAuditCode()

  const pdfItems = data.items && data.items.length > 0
    ? data.items
    : [{ ppeName: data.ppeName || "", ppeCaNumber: data.ppeCaNumber || "", caExpiry: data.ppeCaExpiry, quantity: data.quantity || 0, reason: data.reason || "" }]

  addPageHeader(doc, "FICHA DE ENTREGA DE EPI", "NR-06 | Certificado de Uso Individual")

  const today = data.deliveryDate
    ? `${formatDeliveryDate(data.deliveryDate)} ${formatDeliveryTime(data.deliveryDate)}`
    : format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })

  let currentY = 50
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(230, 230, 230)
  doc.roundedRect(14, currentY, pageWidth - 28, 35, 3, 3, "S")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.setTextColor(r, g, b)
  doc.text(fitSingleLineText(doc, data.employeeName.toUpperCase(), pageWidth - 40), 20, currentY + 10)

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
  doc.text(fitSingleLineText(doc, data.employeeRole || "Não Informado", 62), pageWidth / 2, currentY + 23)

  doc.setTextColor(100, 116, 139)
  doc.setFont("helvetica", "normal")
  doc.text("UNIDADE / CANTEIRO", pageWidth - 20, currentY + 18, { align: "right" })
  doc.setTextColor(30, 41, 59)
  doc.setFont("helvetica", "bold")
  doc.text(fitSingleLineText(doc, data.workplaceName || "Sede", 62), pageWidth - 20, currentY + 23, { align: "right" })

  currentY += 45
  autoTable(doc, {
    startY: currentY,
    head: [["Equipamento (EPI)", "Nº CA", "Venc. CA", "Qtd", "Motivo", "Data Entrega"]],
    body: pdfItems.map(item => [
      normalizeLegacyPdfText(item.ppeName),
      item.ppeCaNumber,
      item.caExpiry ? format(new Date(item.caExpiry), "dd/MM/yyyy") : "-",
      String(item.quantity),
      normalizeLegacyPdfText(item.autoReturnNote ? `${item.reason}\n${item.autoReturnNote}` : item.reason),
      data.deliveryDate ? `${formatDeliveryDate(data.deliveryDate)} ${formatDeliveryTime(data.deliveryDate)}` : format(new Date(), "dd/MM/yyyy HH:mm")
    ]),
    styles: { fontSize: 8.5, cellPadding: 4, font: "helvetica" },
    headStyles: { fillColor: [245, 245, 245], textColor: [71, 85, 105], fontStyle: "bold" },
    margin: { top: 45, right: 14, bottom: 22, left: 14 },
    theme: 'grid',
    didDrawPage: () => {
      if (doc.getCurrentPageInfo().pageNumber > 1) {
        addPageHeader(doc, "FICHA DE ENTREGA DE EPI", "NR-06 | Certificado de Uso Individual")
      }
    },
  })

  // @ts-expect-error - jsPDF-autotable adds lastAutoTable to doc
  currentY = doc.lastAutoTable.finalY + 15
  const signatureBlockHeight = data.authMethod === "facial"
    ? 80
    : data.authMethod === "manual_facial" && data.photoBase64 && data.signatureBase64
      ? 62
      : 58
  const requiredLegalBlockHeight = 35 + signatureBlockHeight + 45
  if (currentY + requiredLegalBlockHeight > pageHeight - 18) {
    doc.addPage()
    addPageHeader(doc, "FICHA DE ENTREGA DE EPI", "NR-06 | Certificado de Uso Individual")
    currentY = 50
  }
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

  const hasSignature = Boolean(data.signatureBase64)
  const hasManualAndPhoto = data.authMethod === 'manual_facial' && Boolean(data.photoBase64) && hasSignature
  let isPhoto = data.authMethod === 'facial'
  let imgRatio = 1

  if (hasSignature && data.signatureBase64) {
    try {
      const imgProps = doc.getImageProperties(data.signatureBase64)
      imgRatio = imgProps.width / imgProps.height
      if (imgRatio <= 1.5) isPhoto = true
      if (imgRatio > 2.5) isPhoto = false
    } catch { /* keep declared method */ }
  }

  if (hasManualAndPhoto && data.photoBase64 && data.signatureBase64) {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.setTextColor(71, 85, 105)
    doc.text("FOTO E ASSINATURA DO COLABORADOR", pageWidth / 2, currentY, { align: "center" })

    const photoSize = 38
    const sigBoxW = 92
    const sigBoxH = 30
    const groupW = photoSize + 12 + sigBoxW
    const photoX = (pageWidth - groupW) / 2
    const sigBoxX = photoX + photoSize + 12
    const boxY = currentY + 5

    doc.setDrawColor(226, 232, 240)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(photoX, boxY, photoSize, photoSize, 3, 3, "FD")
    try {
      const photoProps = doc.getImageProperties(data.photoBase64)
      const photoRatio = photoProps.width / photoProps.height
      let drawW = photoSize - 3
      let drawH = drawW / photoRatio
      if (drawH > photoSize - 3) {
        drawH = photoSize - 3
        drawW = drawH * photoRatio
      }
      doc.addImage(data.photoBase64, getImageFormat(data.photoBase64), photoX + (photoSize - drawW) / 2, boxY + (photoSize - drawH) / 2, drawW, drawH)
    } catch (error) {
      throw new Error("Nao foi possivel inserir a foto de evidencia no PDF.", { cause: error })
    }

    doc.setFillColor(252, 252, 252)
    doc.roundedRect(sigBoxX, boxY + 4, sigBoxW, sigBoxH, 2, 2, "FD")
    try {
      const sigProps = doc.getImageProperties(data.signatureBase64)
      const sigRatio = sigProps.width / sigProps.height
      let drawW = sigBoxW - 8
      let drawH = drawW / sigRatio
      if (drawH > sigBoxH - 6) {
        drawH = sigBoxH - 6
        drawW = drawH * sigRatio
      }
      doc.addImage(data.signatureBase64, getImageFormat(data.signatureBase64), sigBoxX + (sigBoxW - drawW) / 2, boxY + 4 + (sigBoxH - drawH) / 2, drawW, drawH)
    } catch (error) {
      throw new Error("Nao foi possivel inserir a assinatura no PDF.", { cause: error })
    }

    doc.setDrawColor(200, 200, 200)
    doc.line(sigBoxX + 8, boxY + sigBoxH + 8, sigBoxX + sigBoxW - 8, boxY + sigBoxH + 8)
    doc.setFontSize(8)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(30, 41, 59)
    doc.text(data.employeeName.toUpperCase(), pageWidth / 2, boxY + photoSize + 9, { align: "center" })
    doc.setFontSize(6.5)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(148, 163, 184)
    doc.text("Foto capturada no ato + assinatura manual coletada no ato", pageWidth / 2, boxY + photoSize + 14, { align: "center" })

    currentY += photoSize + 24
  } else if (isPhoto && data.signatureBase64) {
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
      doc.addImage(data.signatureBase64, getImageFormat(data.signatureBase64), drawX, drawY, drawW, drawH)
    } catch (e) {
      throw new Error("Nao foi possivel inserir a biometria facial no PDF.", { cause: e })
    }

    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(30, 41, 59)
    doc.text(data.employeeName.toUpperCase(), pageWidth / 2, currentY + containerSize + 16, { align: "center" })

    doc.setFontSize(7)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(148, 163, 184)
    doc.text("Identidade validada por IA (Faceplugin / ONNX)", pageWidth / 2, currentY + containerSize + 21, { align: "center" })

    currentY += containerSize + 30
  } else {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.setTextColor(71, 85, 105)
    doc.text(hasSignature ? "ASSINATURA DO COLABORADOR" : "ASSINATURA DO COLABORADOR (MANUAL)", pageWidth / 2, currentY, { align: "center" })

    const sigBoxW = 100
    const sigBoxH = 30
    const sigBoxX = (pageWidth - sigBoxW) / 2

    doc.setDrawColor(226, 232, 240)
    doc.setFillColor(252, 252, 252)
    doc.roundedRect(sigBoxX, currentY + 4, sigBoxW, sigBoxH, 2, 2, "FD")

    if (data.signatureBase64) try {
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
      doc.addImage(data.signatureBase64, getImageFormat(data.signatureBase64), drawX, drawY, drawW, drawH)
    } catch (error) {
      throw new Error("Nao foi possivel inserir a assinatura no PDF.", { cause: error })
    }

    drawManualSignatureLine(
      doc,
      pageWidth / 2,
      currentY + sigBoxH + 6,
      sigBoxW - 20,
      data.employeeName,
      hasSignature ? "Assinatura digital registrada" : "Assinatura presencial do colaborador"
    )

    currentY += sigBoxH + 28
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
  doc.text(fitSingleLineText(doc, data.location || "Coordenadas não capturadas", pageWidth - 78), metaX, currentY + 35)

  try {
    const qrText = `${COMPANY_CONFIG.systemName} | Valid: ${hash} | Date: ${today}`
    const qrDataUrl = await QRCode.toDataURL(qrText, { width: 200, margin: 1 })
    doc.addImage(qrDataUrl, 'PNG', pageWidth - 45, currentY + 5, 25, 25)
    doc.setFontSize(6)
    doc.setTextColor(200, 200, 200)
    doc.text("Scan to Verify", pageWidth - 32, currentY + 33, { align: "center" })
  } catch {}

  addFootersToEveryPage(doc, hash, data.ipAddress)

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
  validationHash?: string
}

export async function generateReturnPDF(data: ReturnPDFData): Promise<Blob> {
  refreshPdfBrand()
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const hash = data.validationHash || "PENDENTE"

  addPageHeader(doc, "RECIBO DE BAIXA / SUBSTITUIÇÃO E.P.I.", "Registro de Devolução e Troca - NR-06")

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
  const hasReturnSignature = Boolean(data.signatureBase64)
  try {
    if (data.signatureBase64 && data.authMethod === 'manual_facial' && data.photoBase64) {
      doc.addImage(data.photoBase64, 'JPEG', pageWidth / 2 - 48, sigY + 5, 30, 30)
      doc.addImage(data.signatureBase64, 'PNG', pageWidth / 2 - 10, sigY + 8, 70, 24)
    } else if (data.signatureBase64 && data.authMethod === 'facial') {
      doc.addImage(data.signatureBase64, 'JPEG', (pageWidth - 40) / 2, sigY + 3, 40, 40)
    } else if (data.signatureBase64) {
      doc.addImage(data.signatureBase64, 'PNG', (pageWidth - 80) / 2, sigY + 5, 80, 30)
    }
  } catch { /* */ }
  drawManualSignatureLine(
    doc,
    pageWidth / 2,
    sigY + 42,
    pageWidth - 80,
    data.employeeName,
    hasReturnSignature
      ? `${data.authMethod === 'facial' ? 'Biometria Facial' : 'Assinatura Manual'} - ${format(new Date(), "dd/MM/yyyy HH:mm")}`
      : "Assinatura presencial do colaborador"
  )

  addPageFooter(doc, hash)
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
  }[]
  tstSigner?: {
    name: string
    role: string
    signatureBase64: string
    authMethod: AuthMethod
    photoBase64?: string
  }
}

export async function generateNR06PDF(data: NR06PDFData): Promise<Blob> {
  refreshPdfBrand()
  const doc = new jsPDF({ format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  addPageHeader(doc, "FICHA DE CONTROLE DE EPI - NR-06", "Documento de Prontuário Individual do Colaborador")

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
    infoRow(doc, f.label, f.value, x, y, col - 6)
  })

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

  const tableY = boxY + 38
  autoTable(doc, {
    startY: tableY,
    head: [["Data", "EPI", "Nº C.A.", "Qtd", "Motivo", "Status", "Devolução", "Assinatura"]],
    body: itemsWithSigs.map(item => [
      item.deliveryDate,
      item.ppeName,
      item.caNr,
      item.quantity,
      normalizeLegacyPdfText(item.reason),
      item.returnedAt ? "Devolvido" : item.isExpired ? "Troca Pendente" : "Em uso",
      item.returnedAt ? format(new Date(item.returnedAt), "dd/MM/yyyy") : "-",
      "",
    ]),
    styles: {
      fontSize: 7,
      cellPadding: { top: 4, right: 3, bottom: 4, left: 3 },
      font: "helvetica",
      textColor: [30, 41, 59],
      minCellHeight: 22,
    },
    headStyles: {
      fillColor: [r, g, b],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 6.5,
      halign: "center",
      minCellHeight: 10,
      cellPadding: 3,
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
        const cell = hookData.cell
        if (!item) return
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
        } catch (error) {
          throw new Error("Nao foi possivel inserir a assinatura da entrega na ficha NR-06.", { cause: error })
        }
      }
    },
    didDrawPage: () => {
      if (doc.getCurrentPageInfo().pageNumber > 1) {
        addPageHeader(doc, "FICHA DE CONTROLE DE EPI - NR-06", "Documento de Prontuário Individual do Colaborador")
      }
    },
    rowPageBreak: "avoid",
    margin: { top: 45, right: 14, bottom: 22, left: 14 },
  })

  // @ts-expect-error - jsPDF-autotable adds lastAutoTable to doc
  let finalY = doc.lastAutoTable?.finalY || 200
  finalY += 12

  if (data.tstSigner) {
    const tst = data.tstSigner
    const blockWidth = 88
    const blockX = (pageWidth - blockWidth) / 2
    if (finalY + 50 > pageHeight - 20) {
      doc.addPage()
      addPageHeader(doc, "FICHA DE CONTROLE DE EPI - NR-06", "Documento de Prontuário Individual do Colaborador")
      finalY = 50
    }
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
      if (tst.authMethod === 'manual_facial' && tst.photoBase64) {
        const photoSize = 18
        doc.addImage(tst.photoBase64, getImageFormat(tst.photoBase64), blockX + 16, blockY + 11, photoSize, photoSize)
        const drawH = 12
        let drawW = drawH * ratio
        const sigAreaW = contentWidth - photoSize - 8
        if (drawW > sigAreaW) {
          drawW = sigAreaW
        }
        const sigX = blockX + 16 + photoSize + 8 + (sigAreaW - drawW) / 2
        const sigY = blockY + 15
        doc.addImage(tst.signatureBase64, getImageFormat(tst.signatureBase64), sigX, sigY, drawW, drawH)
      } else {
        const isPhoto = ratio <= 1.5
        const drawH = isPhoto ? 20 : 12
        let drawW = drawH * ratio
        if (drawW > contentWidth) {
          drawW = contentWidth
        }
        const sigX = blockX + (blockWidth - drawW) / 2
        const sigY = blockY + 12
        doc.addImage(tst.signatureBase64, getImageFormat(tst.signatureBase64), sigX, sigY, drawW, drawH)
      }
    } catch (error) {
      throw new Error("Nao foi possivel inserir a assinatura do responsavel tecnico na ficha NR-06.", { cause: error })
    }

    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.3)
    doc.line(contentX, blockY + 34, contentX + contentWidth, blockY + 34)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(30, 41, 59)
    doc.text(fitSingleLineText(doc, tst.name.toUpperCase(), contentWidth), contentX, blockY + 40)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(102, 102, 102)
    doc.text(fitSingleLineText(doc, tst.role, contentWidth), contentX, blockY + 45)

    finalY += 56
  }

  addFootersToEveryPage(doc)

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

  const drawFooter = () => {
    doc.setDrawColor(...border)
    doc.setLineWidth(0.2)
    doc.line(mx, ph - 14, pw - mx, ph - 14)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(...muted)
    doc.text(`${COMPANY_CONFIG.systemName} - Relatorio gerencial de conformidade`, mx, ph - 8)
    doc.text(`Pagina ${doc.getCurrentPageInfo().pageNumber}`, pw - mx, ph - 8, { align: "right" })
  }

  doc.setFillColor(248, 250, 252)
  doc.rect(0, 0, pw, ph, "F")
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(mx, 12, pw - mx * 2, 36, 3, 3, "F")
  doc.setDrawColor(...border)
  doc.setLineWidth(0.25)
  doc.roundedRect(mx, 12, pw - mx * 2, 36, 3, 3, "S")
  doc.setFillColor(...brandColor)
  doc.rect(mx, 12, 4, 36, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(...muted)
  if (!addPdfLogo(doc, mx + 10, 18, 30, 15)) {
    doc.text(getPdfCompanyName().toUpperCase(), mx + 10, 23)
  }
  doc.setFontSize(18)
  doc.setTextColor(...ink)
  doc.text("Relatorio gerencial de conformidade e custos", mx + 46, 27)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(...muted)
  doc.text("Indicadores operacionais, rastreabilidade de entregas e leitura executiva do periodo.", mx + 46, 35)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  doc.setTextColor(...brandColor)
  doc.text("BUSINESS INTELLIGENCE", pw - mx - 6, 23, { align: "right" })
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...muted)
  doc.text(format(new Date(), "dd/MM/yyyy 'as' HH:mm"), pw - mx - 6, 31, { align: "right" })
  doc.text(data.periodTitle || "Periodo geral", pw - mx - 6, 38, { align: "right" })

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
      margin: { left: mx, right: mx, bottom: 18 },
      theme: "grid",
      styles: { lineColor: [226, 232, 240], lineWidth: 0.25, overflow: "linebreak" },
      didDrawPage: () => {
        drawFooter()
      },
    })
    tableStartY = ((doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 123) + 12
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
    margin: { left: mx, right: mx, bottom: 18 },
    theme: "grid",
    styles: { lineColor: [226, 232, 240], lineWidth: 0.25, overflow: "linebreak" },
    didDrawPage: () => {
      drawFooter()
    },
  })

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
  const ph = doc.internal.pageSize.getHeight()
  const mx = 14
  const brandColor = [r, g, b] as [number, number, number]
  const ink = [15, 23, 42] as [number, number, number]
  const muted = [100, 116, 139] as [number, number, number]
  const border = [226, 232, 240] as [number, number, number]
  const workplaceName = (id?: string | null) => data.workplaces?.find(w => w.id === id)?.name || "Administrativo"

  const drawFooter = () => {
    doc.setDrawColor(...border)
    doc.setLineWidth(0.2)
    doc.line(mx, ph - 14, pw - mx, ph - 14)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(...muted)
    doc.text(`${COMPANY_CONFIG.systemName} - Relatorio de colaboradores`, mx, ph - 8)
    doc.text(`Pagina ${doc.getCurrentPageInfo().pageNumber}`, pw - mx, ph - 8, { align: "right" })
  }

  doc.setFillColor(248, 250, 252)
  doc.rect(0, 0, pw, ph, "F")
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(mx, 12, pw - mx * 2, 36, 3, 3, "F")
  doc.setDrawColor(...border)
  doc.setLineWidth(0.25)
  doc.roundedRect(mx, 12, pw - mx * 2, 36, 3, 3, "S")
  doc.setFillColor(...brandColor)
  doc.rect(mx, 12, 4, 36, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(...muted)
  if (!addPdfLogo(doc, mx + 10, 18, 30, 15)) {
    doc.text(getPdfCompanyName().toUpperCase(), mx + 10, 23)
  }
  doc.setFontSize(18)
  doc.setTextColor(...ink)
  doc.text("Relatorio executivo de colaboradores", mx + 46, 27)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(...muted)
  doc.text("Quadro funcional, lotacao, status de vinculo e situacao de biometria facial.", mx + 46, 35)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  doc.setTextColor(...brandColor)
  doc.text("DOCUMENTO GERENCIAL", pw - mx - 6, 23, { align: "right" })
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...muted)
  doc.text(format(new Date(), "dd/MM/yyyy 'as' HH:mm"), pw - mx - 6, 31, { align: "right" })
  doc.text(data.periodLabel || "Equipe completa", pw - mx - 6, 38, { align: "right" })

  const activeCount = data.employees.filter(e => e.active).length
  const inactiveCount = data.employees.length - activeCount
  const biometricCount = data.employees.filter(e => e.photo_url).length
  const biometricPendingCount = data.employees.length - biometricCount
  const kpis = [
    { label: "Total", value: data.employees.length, color: brandColor },
    { label: "Ativos", value: activeCount, color: [5, 150, 105] as [number, number, number] },
    { label: "Inativos", value: inactiveCount, color: [217, 119, 6] as [number, number, number] },
    { label: "Biometria", value: biometricCount, color: [37, 99, 235] as [number, number, number] },
    { label: "Pend. biometria", value: biometricPendingCount, color: [220, 38, 38] as [number, number, number] },
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
  doc.text(`${biometricPendingCount} pendencia(s) de biometria facial`, mx + 90, summaryY + 15)
  doc.text("Uso recomendado: conferencia gerencial, TST e auditoria interna.", pw - mx - 7, summaryY + 15, { align: "right" })

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(...ink)
  doc.text("Prontuario de colaboradores", mx, 119)

  autoTable(doc, {
    startY: 123,
    head: [["Nome", "CPF", "Cargo", "Setor", "Obra", "Admissao", "Demissao", "Status", "Biometria"]],
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
      0: { cellWidth: 42, fontStyle: "bold" },
      1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 42 },
      3: { cellWidth: 29 },
      4: { cellWidth: 34 },
      5: { cellWidth: 21, halign: "center" },
      6: { cellWidth: 21, halign: "center" },
      7: { cellWidth: 20, halign: "center", fontStyle: "bold" },
      8: { cellWidth: 25, halign: "center", fontStyle: "bold" },
    },
    margin: { left: mx, right: mx, bottom: 18 },
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
      drawFooter()
    },
  })

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
  const ph = doc.internal.pageSize.getHeight()
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

  const drawFooter = () => {
    const pageLabel = `Pagina ${doc.getCurrentPageInfo().pageNumber}`
    doc.setDrawColor(...border)
    doc.setLineWidth(0.2)
    doc.line(mx, ph - 14, pw - mx, ph - 14)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(...muted)
    doc.text(`${COMPANY_CONFIG.systemName} - Relatorio tecnico de EPIs e CAs`, mx, ph - 8)
    doc.text(pageLabel, pw - mx, ph - 8, { align: "right" })
  }

  doc.setFillColor(248, 250, 252)
  doc.rect(0, 0, pw, ph, "F")
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(mx, 12, pw - mx * 2, 36, 3, 3, "F")
  doc.setDrawColor(...border)
  doc.setLineWidth(0.25)
  doc.roundedRect(mx, 12, pw - mx * 2, 36, 3, 3, "S")
  doc.setFillColor(...brandColor)
  doc.rect(mx, 12, 4, 36, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(...muted)
  if (!addPdfLogo(doc, mx + 10, 18, 30, 15)) {
    doc.text(getPdfCompanyName().toUpperCase(), mx + 10, 23)
  }
  doc.setFontSize(18)
  doc.setTextColor(...ink)
  doc.text("Relatorio tecnico de EPIs e CAs", mx + 46, 27)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(...muted)
  doc.text("Conformidade, validade legal, estoque e custo estimado para gestao operacional.", mx + 46, 35)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  doc.setTextColor(...brandColor)
  doc.text("DOCUMENTO GERENCIAL", pw - mx - 6, 23, { align: "right" })
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...muted)
  doc.text(format(new Date(), "dd/MM/yyyy 'as' HH:mm"), pw - mx - 6, 31, { align: "right" })
  doc.text(data.filterLabel || "Catalogo ativo completo", pw - mx - 6, 38, { align: "right" })

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
    margin: { left: mx, right: mx, bottom: 18 },
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
      drawFooter()
    },
  })

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
  const ph = doc.internal.pageSize.getHeight()
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

  const drawFooter = () => {
    doc.setDrawColor(...border)
    doc.setLineWidth(0.2)
    doc.line(mx, ph - 14, pw - mx, ph - 14)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(...muted)
    doc.text(`${COMPANY_CONFIG.systemName} - Relatorio de estoque`, mx, ph - 8)
    doc.text(`Pagina ${doc.getCurrentPageInfo().pageNumber}`, pw - mx, ph - 8, { align: "right" })
  }

  doc.setFillColor(248, 250, 252)
  doc.rect(0, 0, pw, ph, "F")
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(mx, 12, pw - mx * 2, 36, 3, 3, "F")
  doc.setDrawColor(...border)
  doc.setLineWidth(0.25)
  doc.roundedRect(mx, 12, pw - mx * 2, 36, 3, 3, "S")
  doc.setFillColor(...brandColor)
  doc.rect(mx, 12, 4, 36, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(8)
  doc.setTextColor(...muted)
  if (!addPdfLogo(doc, mx + 10, 18, 30, 15)) {
    doc.text(getPdfCompanyName().toUpperCase(), mx + 10, 23)
  }
  doc.setFontSize(18)
  doc.setTextColor(...ink)
  doc.text("Relatorio de estoque", mx + 46, 27)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(...muted)
  doc.text("Saldo fisico atual, status de reposicao e valor estimado em estoque.", mx + 46, 35)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  doc.setTextColor(...brandColor)
  doc.text("ALMOXARIFADO", pw - mx - 6, 23, { align: "right" })
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...muted)
  doc.text(format(new Date(), "dd/MM/yyyy 'as' HH:mm"), pw - mx - 6, 31, { align: "right" })
  doc.text(data.filterLabel || "Estoque atual", pw - mx - 6, 38, { align: "right" })

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
      0: { cellWidth: 86, fontStyle: "bold" },
      1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 45 },
      3: { cellWidth: 20, halign: "center", fontStyle: "bold" },
      4: { cellWidth: 34, halign: "center", fontStyle: "bold" },
      5: { cellWidth: 32, halign: "right" },
      6: { cellWidth: 39, halign: "right", fontStyle: "bold" },
    },
    margin: { left: mx, right: mx, bottom: 18 },
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
      drawFooter()
    },
  })

  return doc.output("blob")
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

async function imageUrlToBase64(url?: string | null): Promise<string | null> {
  return fetchImageDataUrl(url)
}

export function generateMovementsSimplePDF(data: MovementsReportData): Blob {
  refreshPdfBrand()
  const doc = new jsPDF({ orientation: "portrait", format: "a4" })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const mx = 14

  doc.setFillColor(r, g, b)
  doc.rect(0, 0, pw, 40, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  if (!addPdfLogo(doc, mx, 7, 24, 13)) {
    doc.text(getPdfCompanyName().toUpperCase(), mx, 12)
  }

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
      formatDeliveryDate(m.delivery_date),
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
  doc.text(`${COMPANY_CONFIG.name} - ${COMPANY_CONFIG.systemName}`, mx, ph - 10)
  doc.text(`Total: ${data.movements.length} registros`, pw - mx, ph - 10, { align: "right" })

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

  doc.setFillColor(r, g, b)
  doc.rect(0, 0, pw, 50, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  if (!addPdfLogo(doc, 18, 8, 28, 14)) {
    doc.text(getPdfCompanyName().toUpperCase(), 18, 14)
  }

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
    headStyles: { fillColor: [r, g, b], fontStyle: "bold", fontSize: 7, cellPadding: 2.2, valign: "middle" },
    bodyStyles: { fontSize: 6.6, cellPadding: 2.2, valign: "middle" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 10, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 27 },
      2: { cellWidth: 56 },
      3: { cellWidth: 26 },
      4: { cellWidth: 64 },
      5: { cellWidth: 11, halign: "center" },
      6: { cellWidth: 22, halign: "center" },
      7: { cellWidth: 18 },
      8: { cellWidth: 28, halign: "center" },
    },
    margin: { left: 14, right: 14 },
    theme: "grid",
    styles: { lineColor: [226, 232, 240], lineWidth: 0.3, overflow: "linebreak" },
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
  const signY = Math.min(ph - 32, finalY + 16)
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
    84,
    data.technicianName || "Responsavel tecnico",
    data.technicianRole || "Responsavel tecnico pelo relatorio",
    data.technicianSignatureBase64 ? "Assinatura digital registrada" : "Assinar manualmente sobre a linha"
  )

  doc.setFillColor(r, g, b)
  doc.rect(0, ph - 14, pw, 14, "F")
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  doc.setTextColor(255, 255, 255)
  doc.text(`${COMPANY_CONFIG.name}  ·  Documento Confidencial  ·  ${COMPANY_CONFIG.systemName}`, pw / 2, ph - 5, { align: "center" })
  doc.text("Página 2 de 2", pw - 18, ph - 5, { align: "right" })

  return doc.output("blob")
}
