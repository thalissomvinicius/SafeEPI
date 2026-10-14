import { createHash, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { BIOMETRIC_BUCKET, normalizeStoragePath } from "@/lib/privateStorage"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { isFacialV2Enabled } from "@/lib/facialFeature"
import { isMissingDatabaseColumn } from "@/lib/schemaCompatibility"
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
  storage_bucket?: string
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

const ALLOWED_BUCKETS = new Set([BIOMETRIC_BUCKET, "ppe_signatures"])

/** Queue paths are internal capabilities: reject ambiguity instead of repairing it. */
function safeDeletionPath(value: string, bucket: string) {
  if (typeof value !== "string" || !value || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null
  // URL parsing resolves dot segments; reject them before normalizing a legacy URL.
  let rawPath = value.split("?")[0]
  try {
    for (let depth = 0; depth < 3; depth += 1) {
      const next = decodeURIComponent(rawPath)
      if (next === rawPath) break
      rawPath = next
    }
  } catch { return null }
  if (rawPath.includes("\\") || rawPath.split("/").some(segment => segment === "." || segment === "..")) return null
  const normalized = normalizeStoragePath(value, bucket)
  if (!normalized) return null
  let decoded = normalized
  try {
    for (let depth = 0; depth < 3; depth += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
  } catch { return null }
  if (decoded.includes("\\") || decoded.includes(":") || decoded.includes("%") || /[\u0000-\u001f\u007f]/.test(decoded)
    || decoded.split("/").some(segment => segment === "." || segment === ".." || segment === "")) return null
  return normalized
}

function cleanupCounts(value: unknown) {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  const values = [row.expired_enrollments, row.expired_sessions, row.queued_paths]
  if (values.some(count => typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)) return null
  return { expiredEnrollments: row.expired_enrollments as number, expiredSessions: row.expired_sessions as number, queuedPaths: row.queued_paths as number }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authorization = request.headers.get("authorization") || ""

  if (!cronSecret || cronSecret.length < 32 || !secretsMatch(authorization, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 })
  }

  // The database expires templates and queues only unconsumed capture evidence.
  // Committed receipt evidence is excluded by the RPC, never inferred in this job.
  let expiredCounts = { expiredEnrollments: 0, expiredSessions: 0, queuedPaths: 0 }
  if (isFacialV2Enabled()) {
    const { data: expired, error: expiryError } = await supabaseAdmin.rpc("safeepi_expire_facial_enrollments", { p_limit: 500 })
    const counts = cleanupCounts(expired)
    if (expiryError || !counts) {
      console.error("[biometric-retention] facial expiry unavailable")
      return NextResponse.json({ error: "Falha ao expirar cadastros e sessões faciais." }, { status: 500 })
    }
    expiredCounts = counts
  }

  const { data: legacyDescriptors, error: legacyError } = await supabaseAdmin
    .from("employees")
    .select("id, company_id, face_descriptor")
    .not("face_descriptor", "is", null)
    .is("face_descriptor_encrypted", null)
    .limit(100)

  let migratedDescriptors = 0
  let failedDescriptors = 0
  let legacyMigrationStatus = legacyError ? "lookup_failed" : "ok"
  if (legacyError) console.error("[biometric-retention] legacy descriptor lookup unavailable; continuing retention")
  for (const employee of (legacyError ? [] : legacyDescriptors || []) as LegacyDescriptorItem[]) {
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
      console.error("[biometric-retention] legacy descriptor migration failed")
      if (migrationError instanceof BiometricEncryptionConfigurationError) {
        legacyMigrationStatus = "configuration_missing"
      } else if (legacyMigrationStatus !== "configuration_missing") {
        legacyMigrationStatus = "partial_failure"
      }
    }
  }

  const readQueue = (includeBucket: boolean) => {
    const table = supabaseAdmin.from("biometric_deletion_queue")
    const selected = includeBucket
      ? table.select("id, storage_path, storage_bucket, attempts")
      : table.select("id, storage_path, attempts")
    return selected.is("processed_at", null).lt("attempts", 5).order("created_at", { ascending: true }).limit(100)
  }
  let queue = await readQueue(true)
  let legacyBucketColumn = false
  if (isMissingDatabaseColumn(queue.error, "storage_bucket") && !isFacialV2Enabled()) {
    // The old queue contains biometric_photos only. Do not hide a v2 schema
    // failure, or retry permission/network errors as an older schema.
    queue = await readQueue(false)
    legacyBucketColumn = true
  }
  const { data, error } = queue

  if (error) {
    console.error("[biometric-retention] queue lookup failed")
    return NextResponse.json({ error: "Falha ao consultar a fila.", ...expiredCounts, migratedDescriptors, failedDescriptors, legacyMigrationStatus }, { status: 500 })
  }

  let processed = 0
  let failed = 0

  for (const item of (data || []) as DeletionQueueItem[]) {
    const bucket = legacyBucketColumn ? BIOMETRIC_BUCKET : item.storage_bucket || ""
    const allowedBucket = ALLOWED_BUCKETS.has(bucket)
    const storagePath = allowedBucket ? safeDeletionPath(item.storage_path, bucket) : null

    if (!storagePath) {
      failed += 1
      await supabaseAdmin
        .from("biometric_deletion_queue")
        .update({ attempts: item.attempts + 1, last_error: allowedBucket ? "invalid_storage_path" : "invalid_storage_bucket" })
        .eq("id", item.id)
      continue
    }

    const { error: removeError } = await supabaseAdmin.storage
      .from(bucket)
      .remove([storagePath])

    if (removeError) {
      failed += 1
      console.error("[biometric-retention] storage deletion failed", { queueId: item.id })
      await supabaseAdmin
        .from("biometric_deletion_queue")
        .update({
          attempts: item.attempts + 1,
          last_error: "storage_deletion_failed",
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
      console.error("[biometric-retention] queue completion failed")
      continue
    }

    processed += 1
  }

  return NextResponse.json({
    facialV2Enabled: isFacialV2Enabled(),
    ...expiredCounts,
    processed,
    failed,
    pendingBatch: data?.length || 0,
    migratedDescriptors,
    failedDescriptors,
    legacyMigrationStatus,
  })
}
