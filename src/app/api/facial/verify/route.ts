import { verifyFacialSession, facialErrorResponse } from "@/lib/facialServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try { return await verifyFacialSession(request) }
  catch (error) { return facialErrorResponse(error) }
}
