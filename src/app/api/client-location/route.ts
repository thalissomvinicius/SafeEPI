import { NextResponse } from "next/server"

import { getVercelNetworkGeolocation } from "@/lib/vercelGeolocation"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  const location = getVercelNetworkGeolocation(request)
  const headers = { "Cache-Control": "private, no-store, max-age=0" }

  if (!location) {
    return NextResponse.json(
      { error: "Localização de rede indisponível." },
      { status: 503, headers },
    )
  }

  return NextResponse.json(
    { location: location.value, source: location.source },
    { headers },
  )
}
