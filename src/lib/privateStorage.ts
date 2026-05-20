import "server-only"

import { supabaseAdmin } from "@/lib/supabaseAdmin"

export const PRIVATE_STORAGE_BUCKET = "ppe_signatures"
export const STORAGE_VIEW_EXPIRES_IN = 60
export const STORAGE_DOWNLOAD_EXPIRES_IN = 300

type SignedUrlMode = "view" | "download"

type SignedUrlOptions = {
  mode?: SignedUrlMode
  downloadName?: string
}

function clampExpiresIn(expiresIn: number, mode: SignedUrlMode) {
  const max = mode === "download" ? STORAGE_DOWNLOAD_EXPIRES_IN : STORAGE_VIEW_EXPIRES_IN
  return Math.max(1, Math.min(Math.floor(expiresIn || max), max))
}

export function normalizeStoragePath(value?: string | null, bucket = PRIVATE_STORAGE_BUCKET) {
  if (!value) return null
  const raw = value.trim()
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return null

  try {
    const url = new URL(raw)
    const marker = `/storage/v1/object/`
    const markerIndex = url.pathname.indexOf(marker)
    if (markerIndex === -1) return null

    const afterMarker = url.pathname.slice(markerIndex + marker.length)
    const bucketPrefix = `public/${bucket}/`
    const signedBucketPrefix = `sign/${bucket}/`
    const rawPath = afterMarker.startsWith(bucketPrefix)
      ? afterMarker.slice(bucketPrefix.length)
      : afterMarker.startsWith(signedBucketPrefix)
        ? afterMarker.slice(signedBucketPrefix.length)
        : null

    return rawPath ? decodeURIComponent(rawPath) : null
  } catch {
    return raw.replace(/^\/+/, "")
  }
}

export async function getSignedUrl(
  bucket: string,
  pathOrUrl: string | null | undefined,
  expiresIn = STORAGE_VIEW_EXPIRES_IN,
  options: SignedUrlOptions = {},
) {
  const mode = options.mode || "view"
  const path = normalizeStoragePath(pathOrUrl, bucket)
  if (!path) return null

  const signedOptions = mode === "download"
    ? { download: options.downloadName || true }
    : undefined

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, clampExpiresIn(expiresIn, mode), signedOptions)

  if (error || !data?.signedUrl) {
    console.error("[privateStorage] signed URL error:", error)
    return null
  }

  return { signedUrl: data.signedUrl, path }
}

export async function signStorageValue(
  value: string | null | undefined,
  options: SignedUrlOptions & { bucket?: string; expiresIn?: number } = {},
) {
  if (!value) return null
  if (value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("/")) return value

  const result = await getSignedUrl(
    options.bucket || PRIVATE_STORAGE_BUCKET,
    value,
    options.expiresIn || (options.mode === "download" ? STORAGE_DOWNLOAD_EXPIRES_IN : STORAGE_VIEW_EXPIRES_IN),
    options,
  )

  return result?.signedUrl || value
}

export async function setPrivateBucket(bucket = PRIVATE_STORAGE_BUCKET) {
  const { error } = await supabaseAdmin.storage.updateBucket(bucket, {
    public: false,
  })

  if (error) throw error
}
