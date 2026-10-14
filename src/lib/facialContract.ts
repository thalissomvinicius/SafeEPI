import { z } from "zod"

/** Public types contain no template, image, credential or server secret. */
export const FACIAL_MODEL_ID = "opencv-sface-2021dec"
export const FACIAL_SESSION_TTL_SECONDS = 120
export const FACIAL_MAX_FRAME_BYTES = 2_000_000
export const facialUuidSchema = z.string().uuid()
export const facialReasonSchema = z.enum(["Primeira Entrega", "Substituição (Desgaste/Validade)", "Perda", "Dano"])
export const facialItemInputSchema = z.object({
  ppe_id: facialUuidSchema,
  quantity: z.number().int().min(1).max(1000),
  reason: facialReasonSchema,
})
export const facialContextInputSchema = z.object({
  workplace_id: facialUuidSchema.nullable().optional(),
  third_party_id: facialUuidSchema.nullable().optional(),
  delivery_date: z.string().min(10).max(35).refine(value => Number.isFinite(Date.parse(value))).optional(),
  items: z.array(facialItemInputSchema).min(1).max(100),
})
export type FacialContextInput = z.infer<typeof facialContextInputSchema>
export type FacialDeliveryContext = {
  company_id: string
  employee_id: string
  workplace_id: string | null
  third_party_id: string | null
  delivery_date: string
  items: Array<z.infer<typeof facialItemInputSchema> & { ppe_name: string; ca_number: string }>
  delivery_ids?: string[]
}
export type FacialProfileStatus = "active" | "pending" | "not_enrolled" | "recapture_required"
export type FacialApproval = { session_id: string; context_hash: string; expires_at: string }
export const facialEmbeddingSchema = z.array(z.number().finite().min(-100).max(100)).length(128)
  .refine(values => values.some(value => Math.abs(value) > 1e-12), "Template vazio.")
export const facialEnrollmentSchema = z.object({
  embedding: facialEmbeddingSchema,
  model_id: z.literal(FACIAL_MODEL_ID),
  model_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  quality: z.number().finite().min(0).max(1),
})
const optionalScore = z.number().finite().min(0).max(1).nullable().optional()
export const facialVerificationSchema = z.object({
  decision: z.enum(["approved", "rejected", "unavailable"]),
  reason: z.string().max(200),
  model_id: z.literal(FACIAL_MODEL_ID),
  model_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  similarity: z.number().finite().min(-1).max(1).nullable().optional(),
  threshold: optionalScore,
  pad_score: optionalScore,
  pad_threshold: optionalScore,
  pad_model_id: z.string().max(200).nullable().optional(),
  calibration_id: z.string().max(200).nullable().optional(),
  quality: optionalScore,
}).superRefine((value, ctx) => {
  if (value.decision !== "approved") return
  if (value.similarity == null || value.threshold == null || value.threshold <= 0 || value.similarity < value.threshold
    || value.pad_score == null || value.pad_threshold == null || value.pad_threshold <= 0 || value.pad_score < value.pad_threshold
    || !value.pad_model_id?.trim() || !value.calibration_id?.trim()) {
    ctx.addIssue({ code: "custom", message: "Aprovação sem reconhecimento e PAD calibrados." })
  }
})

/** Legacy photo clients may send null/[]; they may never create a trusted template. */
export function hasClientBiometricMaterial(payload: Record<string, unknown>) {
  return ["face_descriptor", "face_descriptor_encrypted", "biometric_key_version", "embedding", "embedding_encrypted"].some(key => {
    const value = payload[key]
    return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)
  })
}
