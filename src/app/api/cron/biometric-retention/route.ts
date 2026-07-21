import { createHash, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { BIOMETRIC_BUCKET, normalizeStoragePath } from "@/lib/privateStorage"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import {
  BIOMETRIC_KEY_VERSION,
  BiometricEncryptionConfigurationError,
  encryptBiometricDescriptor,
} from "@/lib/biometricEncryption"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DeletionQueueItem = {
  id: string
  storage_path: string
  attempts: number
}

type LegacyDescriptorItem = {
  id: string
  company_id: string
  face_descriptor: number[]
}

function secretsMatch(received: string, expected: string) {
  const receivedHash = createHash("sha256").update(received).digest()
  const expectedHash = createHash("sha256").update(expected).digest()
  return timingSafeEqual(receivedHash, expectedHash)
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authorization = request.headers.get("authorization") || ""

  if (!cronSecret || cronSecret.length < 32 || !secretsMatch(authorization, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 })
  }

  const { data: legacyDescriptors, error: legacyError } = await supabaseAdmin
    .from("employees")
    .select("id, company_id, face_descriptor")
    .not("face_descriptor", "is", null)
    .is("face_descriptor_encrypted", null)
    .limit(100)

  if (legacyError) {
    console.error("[biometric-retention] legacy descriptor lookup failed:", legacyError)
    return NextResponse.json({ error: "Falha ao consultar descritores legados." }, { status: 500 })
  }

  let migratedDescriptors = 0
  let failedDescriptors = 0
  for (const employee of (legacyDescriptors || []) as LegacyDescriptorItem[]) {
    try {
      const encrypted = encryptBiometricDescriptor(employee.face_descriptor, employee.company_id)
      const { error: updateError } = await supabaseAdmin
        .from("employees")
        .update({
          face_descriptor_encrypted: encrypted,
          biometric_key_version: BIOMETRIC_KEY_VERSION,
          face_descriptor: null,
        })
        .eq("id", employee.id)
        .eq("company_id", employee.company_id)
        .is("face_descriptor_encrypted", null)
      if (updateError) throw updateError
      migratedDescriptors += 1
    } catch (migrationError) {
      failedDescriptors += 1
      console.error("[biometric-retention] descriptor migration failed:", {
        employeeId: employee.id,
        message: migrationError instanceof Error ? migrationError.message : "unknown",
      })
      if (migrationError instanceof BiometricEncryptionConfigurationError) {
        return NextResponse.json({ error: "Criptografia biometrica nao configurada." }, { status: 503 })
      }
    }
  }

  const { data, error } = await supabaseAdmin
    .from("biometric_deletion_queue")
    .select("id, storage_path, attempts")
    .is("processed_at", null)
    .lt("attempts", 5)
    .order("created_at", { ascending: true })
    .limit(100)

  if (error) {
    console.error("[biometric-retention] queue lookup failed:", error)
    return NextResponse.json({ error: "Falha ao consultar a fila." }, { status: 500 })
  }

  let processed = 0
  let failed = 0

  for (const item of (data || []) as DeletionQueueItem[]) {
    const storagePath = normalizeStoragePath(item.storage_path, BIOMETRIC_BUCKET)

    if (!storagePath) {
      failed += 1
      await supabaseAdmin
        .from("biometric_deletion_queue")
        .update({ attempts: item.attempts + 1, last_error: "invalid_storage_path" })
        .eq("id", item.id)
      continue
    }

    const { error: removeError } = await supabaseAdmin.storage
      .from(BIOMETRIC_BUCKET)
      .remove([storagePath])

    if (removeError) {
      failed += 1
      console.error("[biometric-retention] storage deletion failed:", {
        queueId: item.id,
        message: removeError.message,
      })
      await supabaseAdmin
        .from("biometric_deletion_queue")
        .update({
          attempts: item.attempts + 1,
          last_error: removeError.message.slice(0, 500),
        })
        .eq("id", item.id)
      continue
    }

    const { error: markError } = await supabaseAdmin
      .from("biometric_deletion_queue")
      .update({ processed_at: new Date().toISOString(), last_error: null })
      .eq("id", item.id)

    if (markError) {
      failed += 1
      console.error("[biometric-retention] queue completion failed:", markError)
      continue
    }

    processed += 1
  }

  return NextResponse.json({
    processed,
    failed,
    pendingBatch: data?.length || 0,
    migratedDescriptors,
    failedDescriptors,
  })
}
