import { z } from "zod"

/** Stock adjustments must use the audited stock-movement operation. */
export const ppeCatalogUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  manufacturer: z.string().trim().min(1).max(200).optional(),
  ca_number: z.string().trim().min(1).max(80).optional(),
  ca_expiry_date: z.iso.date().or(z.iso.datetime({ offset: true })).nullable().optional(),
  lifespan_days: z.number().int().min(0).max(36_500).optional(),
  cost: z.number().finite().min(0).max(1_000_000_000).optional(),
  active: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Nenhum campo para atualizar.")
