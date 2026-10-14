import { getFacialProfile, facialErrorResponse } from "@/lib/facialServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try { return await getFacialProfile(request) }
  catch (error) { return facialErrorResponse(error) }
}
