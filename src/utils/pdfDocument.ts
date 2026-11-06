import jsPDF, { type jsPDFOptions } from "jspdf"

export type PdfDocumentOptions = Omit<jsPDFOptions, "compress" | "compressPdf" | "filters">

/** New documents only: lossless stream/PNG compression, without changing pixels.
 * Never use this factory to rewrite an already archived original or its hash.
 */
export function createPdfDocument(options: PdfDocumentOptions = {}): jsPDF {
  // Set both flags last: even an untyped caller cannot disable compression with
  // a legacy compress flag or an empty/custom filter list.
  return new jsPDF({ ...options, compress: true, filters: ["FlateEncode"] })
}
