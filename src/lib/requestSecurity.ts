import "server-only"

import { createHash } from "node:crypto"

export class RequestTooLargeError extends Error {
  readonly status = 413

  constructor(message = "Corpo da requisicao muito grande.") {
    super(message)
    this.name = "RequestTooLargeError"
  }
}
export function assertRequestSize(request: Request, maxBytes: number): void {
  const rawLength = request.headers.get("content-length")
  if (!rawLength) return

  const length = Number(rawLength)
  if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
    throw new RequestTooLargeError()
  }
}

export async function readJsonWithLimit<T = unknown>(
  request: Request,
  maxBytes: number,
): Promise<T> {
  assertRequestSize(request, maxBytes)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > maxBytes) {
    throw new RequestTooLargeError()
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    throw new SyntaxError("JSON invalido.")
  }
}

export async function buildRateLimitKey(scope: string, identifier: string): Promise<string> {
  const hash = createHash("sha256").update(identifier).digest("hex")
  return `${scope}:${hash}`
}
