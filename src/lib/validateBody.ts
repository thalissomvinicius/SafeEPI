import { NextResponse } from "next/server"
import type { ZodSchema } from "zod"

export function validateBody<T>(schema: ZodSchema<T>, body: unknown): { data: T } {
  const result = schema.safeParse(body)

  if (!result.success) {
    console.error("[validateBody] invalid request body:", result.error.flatten())
    throw NextResponse.json({ error: "Dados invalidos." }, { status: 400 })
  }

  return { data: result.data }
}

export function isValidationResponse(error: unknown): error is Response {
  return error instanceof Response
}
