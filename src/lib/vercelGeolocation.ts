import { isValidGeoLocation } from "@/utils/geolocation"

export type NetworkGeolocation = {
  value: string
  source: "network"
}

export function getVercelNetworkGeolocation(request: Request): NetworkGeolocation | null {
  const latitude = request.headers.get("x-vercel-ip-latitude")?.trim()
  const longitude = request.headers.get("x-vercel-ip-longitude")?.trim()
  if (!latitude || !longitude) return null

  const value = `${latitude}, ${longitude}`
  if (!isValidGeoLocation(value)) return null

  return { value, source: "network" }
}
