import type { Company } from "@/types/database"

export type ActiveBrand = {
  name: string
  logoUrl: string | null
  logoDataUrl: string | null
  primaryColor: string
}

const BRAND_KEY = "safeepi_active_brand"
const DEFAULT_COLOR = "#2563EB"

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
    logoUrl: "/logo.png",
    logoDataUrl: null,
    primaryColor: DEFAULT_COLOR,
  }
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
      primaryColor: normalizeHexColor(parsed.primaryColor),
    }
  } catch {
    return getFallbackBrand()
  }
}

export function clearCompanyTheme() {
  if (typeof document === "undefined") return
  document.body.classList.remove("company-theme")
  document.body.style.removeProperty("--brand-color")
  document.body.style.removeProperty("--brand-color-strong")
}

async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { mode: "cors" })
    const blob = await response.blob()
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

  const primaryColor = normalizeHexColor(company?.primary_color)
  const logoUrl = company?.logo_url || "/logo.png"
  const brand: ActiveBrand = {
    name: company?.trade_name || company?.name || "SafeEPI",
    logoUrl,
    logoDataUrl: null,
    primaryColor,
  }

  window.localStorage.setItem(BRAND_KEY, JSON.stringify(brand))

  if (options.enableTheme !== false) {
    document.body.classList.add("company-theme")
    document.body.style.setProperty("--brand-color", primaryColor)
    document.body.style.setProperty("--brand-color-strong", darkenHexColor(primaryColor))
  }

  const dataUrl = await imageUrlToDataUrl(logoUrl)
  if (dataUrl) {
    window.localStorage.setItem(BRAND_KEY, JSON.stringify({ ...brand, logoDataUrl: dataUrl }))
  }
}
