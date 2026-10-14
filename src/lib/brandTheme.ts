import type { Company } from "@/types/database"

export type ActiveBrand = {
  name: string
  cnpj: string | null
  logoUrl: string | null
  logoDataUrl: string | null
  primaryColor: string
}

const BRAND_KEY = "safeepi_active_brand"
export const BRAND_CHANGED_EVENT = "safeepi:brand-changed"
const DEFAULT_COLOR = "#2563EB"
let brandGeneration = 0
let logoController: AbortController | null = null

export function normalizeHexColor(color?: string | null) {
  if (!color) return DEFAULT_COLOR
  const trimmed = color.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed
  if (/^#[0-9A-Fa-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
  }
  return DEFAULT_COLOR
}

export function hexToRgb(color?: string | null): [number, number, number] {
  const hex = normalizeHexColor(color).slice(1)
  const value = Number.parseInt(hex, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function darkenHexColor(color: string) {
  const [r, g, b] = hexToRgb(color)
  return `#${[r, g, b].map((part) => Math.max(0, Math.floor(part * 0.82)).toString(16).padStart(2, "0")).join("")}`
}

function getFallbackBrand(): ActiveBrand {
  return {
    name: "SafeEPI",
    cnpj: null,
    logoUrl: "/logo.png",
    logoDataUrl: null,
    primaryColor: DEFAULT_COLOR,
  }
}

function emitBrandChanged(brand: ActiveBrand) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<ActiveBrand>(BRAND_CHANGED_EVENT, { detail: brand }))
}

export function getStoredBrand(): ActiveBrand {
  if (typeof window === "undefined") return getFallbackBrand()

  try {
    const raw = window.localStorage.getItem(BRAND_KEY)
    if (!raw) return getFallbackBrand()
    const parsed = JSON.parse(raw) as Partial<ActiveBrand>
    return {
      ...getFallbackBrand(),
      ...parsed,
      cnpj: typeof parsed.cnpj === "string" ? parsed.cnpj : null,
      primaryColor: normalizeHexColor(parsed.primaryColor),
    }
  } catch {
    return getFallbackBrand()
  }
}

export function clearCompanyTheme() {
  if (typeof document === "undefined") return
  brandGeneration += 1
  logoController?.abort()
  logoController = null
  document.body.classList.remove("company-theme")
  document.body.style.removeProperty("--brand-color")
  document.body.style.removeProperty("--brand-color-strong")
  emitBrandChanged(getFallbackBrand())
}

async function imageUrlToDataUrl(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(url, { mode: "cors", signal })
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.startsWith("image/") || blob.size > 2 * 1024 * 1024) return null
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function applyCompanyBrand(company?: Company | null, options: { enableTheme?: boolean } = {}) {
  if (typeof window === "undefined") return

  const generation = ++brandGeneration
  logoController?.abort()
  logoController = null

  const primaryColor = normalizeHexColor(company?.primary_color)
  const logoUrl = company?.logo_url || "/logo.png"
  const previousBrand = getStoredBrand()
  const brand: ActiveBrand = {
    name: company?.trade_name || company?.name || "SafeEPI",
    cnpj: company?.cnpj || null,
    logoUrl,
    logoDataUrl: previousBrand.logoUrl === logoUrl ? previousBrand.logoDataUrl : null,
    primaryColor,
  }

  if (options.enableTheme !== false) {
    document.body.classList.add("company-theme")
    document.body.style.setProperty("--brand-color", primaryColor)
    document.body.style.setProperty("--brand-color-strong", darkenHexColor(primaryColor))
  }

  try { window.localStorage.setItem(BRAND_KEY, JSON.stringify(brand)) } catch { /* storage may be unavailable */ }
  emitBrandChanged(brand)

  // Color and tenant identity must never wait for an external logo request.
  if (brand.logoDataUrl) return
  const controller = new AbortController()
  logoController = controller
  const timeout = window.setTimeout(() => controller.abort(), 5000)
  void imageUrlToDataUrl(logoUrl, controller.signal).then((dataUrl) => {
    if (!dataUrl || controller.signal.aborted || generation !== brandGeneration) return
    const brandWithLogoData = { ...brand, logoDataUrl: dataUrl }
    try { window.localStorage.setItem(BRAND_KEY, JSON.stringify(brandWithLogoData)) } catch { /* optional cache */ }
    emitBrandChanged(brandWithLogoData)
  }).finally(() => {
    window.clearTimeout(timeout)
    if (logoController === controller) logoController = null
  })
}
