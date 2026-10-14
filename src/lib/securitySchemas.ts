import { z } from "zod"

export const uuidSchema = z.string().uuid()
export const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/i)

/** Public employee fields only. Tenant, identity keys and audit fields are server-owned. */
export const employeeWriteSchema = z.object({
  registration_number: z.string().trim().max(64).transform(value => value || null).nullable().optional(),
  full_name: z.string().trim().min(1).max(200).optional(),
  cpf: z.string().trim().min(1).max(20).optional(),
  job_title: z.string().max(200).optional(),
  department: z.string().max(200).nullable().optional(),
  admission_date: z.string().max(35).nullable().optional(),
  termination_date: z.string().max(35).nullable().optional(),
  active: z.boolean().optional(),
  workplace_id: uuidSchema.nullable().optional(),
  third_party_id: uuidSchema.nullable().optional(),
  photo_url: z.string().max(2000).nullable().optional(),
}).strict()

export const createUserSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
  full_name: z.string().trim().min(1).max(200),
  role: z.enum(["ADMIN", "ALMOXARIFE", "DIRETORIA"]),
  company_id: z.string().uuid().nullable().optional(),
})

export const updateUserSchema = z.object({
  id: uuidSchema,
  password: z.string().min(8).max(256).optional(),
  full_name: z.string().trim().min(1).max(200).optional(),
  role: z.enum(["ADMIN", "ALMOXARIFE", "DIRETORIA"]).optional(),
})

export const remoteLinkCreateSchema = z.object({
  employee_id: uuidSchema,
  type: z.enum(["delivery", "capture", "training_signature"]),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  expires_hours: z.coerce.number().int().min(1).max(168).default(24),
  company_id: z.string().uuid().nullable().optional(),
})

export const remoteLinkCompleteSchema = z.object({
  token: tokenSchema,
})

export const remoteCaptureSchema = z.object({
  id: uuidSchema,
  token: tokenSchema,
  photo_url: z.string()
    .max(4_500_000)
    .regex(/^data:image\/(png|jpe?g|webp);base64,/i),
  // Legacy photo endpoint cannot create biometric references, even encrypted ones.
  face_descriptor: z.array(z.never()).length(0).nullable().optional(),
  face_descriptor_encrypted: z.null().optional(),
  biometric_key_version: z.null().optional(),
  embedding: z.null().optional(),
  embedding_encrypted: z.null().optional(),
})

export const remoteDeliveryFieldsSchema = z.object({
  employee_id: uuidSchema,
  ppe_id: uuidSchema,
  workplace_id: z.string().nullable().optional(),
  third_party_id: z.string().nullable().optional(),
  reason: z.string().max(120).optional(),
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
  ip_address: z.string().max(120).optional(),
  auth_method: z.string().max(40).default("manual"),
  token: tokenSchema,
})

export const uploadFieldsSchema = z.object({
  employee_id: z.string().max(120).optional(),
  auth_method: z.string().max(40).optional(),
  company_id: z.string().max(120).optional(),
  document_type: z.string().max(80).optional(),
  file_name: z.string().max(180).optional(),
  link_token: z.string().max(120).optional(),
})
