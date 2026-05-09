"use client"

import { useEffect, useState } from "react"
import { BRAND_CHANGED_EVENT, getStoredBrand, normalizeHexColor, type ActiveBrand } from "@/lib/brandTheme"
import type { Company } from "@/types/database"

function brandFromCompany(company?: Company | null): ActiveBrand | null {
  if (!company) return null

  return {
    name: company.trade_name || company.name || "SafeEPI",
    logoUrl: company.logo_url || "/logo.png",
    logoDataUrl: null,
    primaryColor: normalizeHexColor(company.primary_color),
  }
}

function normalizeBrand(brand: ActiveBrand): ActiveBrand {
  return {
    ...brand,
    primaryColor: normalizeHexColor(brand.primaryColor),
  }
}

export function useActiveBrand(fallbackCompany?: Company | null) {
  const [brand, setBrand] = useState<ActiveBrand>(() => brandFromCompany(fallbackCompany) || getStoredBrand())

  useEffect(() => {
    setBrand(brandFromCompany(fallbackCompany) || getStoredBrand())
  }, [
    fallbackCompany?.id,
    fallbackCompany?.logo_url,
    fallbackCompany?.name,
    fallbackCompany?.primary_color,
    fallbackCompany?.trade_name,
  ])

  useEffect(() => {
    const handleBrandChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as ActiveBrand | undefined) : undefined
      setBrand(detail ? normalizeBrand(detail) : getStoredBrand())
    }

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "safeepi_active_brand") {
        setBrand(getStoredBrand())
      }
    }

    window.addEventListener(BRAND_CHANGED_EVENT, handleBrandChanged)
    window.addEventListener("storage", handleStorage)

    return () => {
      window.removeEventListener(BRAND_CHANGED_EVENT, handleBrandChanged)
      window.removeEventListener("storage", handleStorage)
    }
  }, [])

  return brand
}
