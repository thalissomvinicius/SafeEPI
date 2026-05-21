import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import {
  getSignedUrl,
  BIOMETRIC_BUCKET,
  normalizeStoragePath,
  PRIVATE_STORAGE_BUCKET,
  STORAGE_DOWNLOAD_EXPIRES_IN,
  STORAGE_VIEW_EXPIRES_IN,
} from "@/lib/privateStorage"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"

type AssetRequest = {
  key?: string
  bucket?: string
  path?: string | null
  mode?: "view" | "download"
  downloadName?: string
}

async function pathExistsInTenant(path: string, companyId: string) {
  const checks = [
    supabaseAdmin.from("employees").select("id").eq("company_id", companyId).eq("photo_url", path).limit(1),
    supabaseAdmin.from("deliveries").select("id").eq("company_id", companyId).eq("signature_url", path).limit(1),
    supabaseAdmin.from("companies").select("id").eq("id", companyId).eq("logo_url", path).limit(1),
    supabaseAdmin.from("signed_documents").select("id").eq("company_id", companyId).eq("storage_path", path).limit(1),
    supabaseAdmin.from("signed_documents").select("id").eq("company_id", companyId).eq("document_url", path).limit(1),
    supabaseAdmin.from("signed_documents").select("id").eq("company_id", companyId).eq("signature_url", path).limit(1),
    supabaseAdmin.from("signed_documents").select("id").eq("company_id", companyId).eq("photo_evidence_url", path).limit(1),
  ]

  for (const query of checks) {
    const { data, error } = await query
    if (!error && data && data.length > 0) return true
  }

  return false
}

async function canSignPath(
  user: { role: string; company_id: string | null },
  path: string,
  bucket: string,
) {
  if (bucket !== PRIVATE_STORAGE_BUCKET && bucket !== BIOMETRIC_BUCKET) return user.role === "MASTER"
  if (user.role === "MASTER") return true
  if (!user.company_id) return false

  if (bucket === BIOMETRIC_BUCKET) {
    if (path.startsWith(`${user.company_id}/`)) return true
    return pathExistsInTenant(path, user.company_id)
  }

  if (
    path.startsWith(`${user.company_id}/`) ||
    path.startsWith(`company-logos/${user.company_id}/`) ||
    path.startsWith(`signed-documents/${user.company_id}/`)
  ) {
    return true
  }

  return pathExistsInTenant(path, user.company_id)
}

export async function POST(request: Request) {
  const auth = await requireAuthorizedUser(request)
  if (!auth.authorized) return auth.response

  const limited = rateLimit(`storage:signed-url:user:${auth.user.id}`, 60, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  try {
    const body = await request.json()
    const assets = Array.isArray(body?.assets) ? body.assets as AssetRequest[] : []

    if (assets.length === 0 || assets.length > 50) {
      return NextResponse.json({ error: "Lista de arquivos invalida." }, { status: 400 })
    }

    const signedAssets = await Promise.all(
      assets.map(async (asset, index) => {
        const bucket = asset.bucket || PRIVATE_STORAGE_BUCKET
        const path = normalizeStoragePath(asset.path, bucket)
        if (!path) {
          return {
            key: asset.key || String(index),
            path: asset.path || null,
            signedUrl: asset.path || null,
            allowed: false,
          }
        }

        const allowed = await canSignPath(auth.user, path, bucket)
        if (!allowed) {
          return {
            key: asset.key || String(index),
            path,
            signedUrl: null,
            allowed: false,
          }
        }

        const mode = asset.mode === "download" ? "download" : "view"
        const expiresIn = mode === "download" ? STORAGE_DOWNLOAD_EXPIRES_IN : STORAGE_VIEW_EXPIRES_IN
        const signed = await getSignedUrl(bucket, path, expiresIn, {
          mode,
          downloadName: asset.downloadName,
        })

        return {
          key: asset.key || String(index),
          path,
          signedUrl: signed?.signedUrl || null,
          allowed: Boolean(signed?.signedUrl),
          expiresIn,
        }
      }),
    )

    return NextResponse.json({ assets: signedAssets })
  } catch (error) {
    console.error("[/api/storage/signed-url] error:", error)
    return NextResponse.json({ error: "Nao foi possivel gerar URL temporaria." }, { status: 500 })
  }
}
