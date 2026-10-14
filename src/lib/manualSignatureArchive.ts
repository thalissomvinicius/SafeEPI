import { calculateSha256 } from "@/lib/documentIntegrity"
import { MANUAL_ACCEPTANCE_TEXT, MANUAL_ACCEPTANCE_VERSION, parseManualSignatureDeclaration } from "@/lib/manualSignatureEvidence"

export async function buildManualSignatureArchive(value: unknown) {
  const declaration = parseManualSignatureDeclaration(value)
  if (!declaration) throw new Error("Declaração de assinatura inválida ou termo desatualizado. Reabra a tela e confira o aceite.")
  return {
    origin: declaration.origin,
    accepted: declaration.accepted,
    source: "browser_declaration",
    identity_verified: false,
    ...(declaration.accepted ? {
      term_version: MANUAL_ACCEPTANCE_VERSION,
      term_text: MANUAL_ACCEPTANCE_TEXT,
      term_sha256: await calculateSha256(new TextEncoder().encode(MANUAL_ACCEPTANCE_TEXT)),
    } : {}),
  }
}
