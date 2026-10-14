import { startFacialSession, facialErrorResponse } from "@/lib/facialServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try { return await startFacialSession(request) }
  catch (error) { return facialErrorResponse(error) }
}
