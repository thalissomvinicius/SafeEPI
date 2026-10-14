import type { Profile } from "@/types/database"

const COMPANY_ROLES = new Set<Profile["role"]>(["ADMIN", "ALMOXARIFE", "DIRETORIA"])

/** A company membership is authoritative; stale profile/token roles cannot restore it. */
export function resolveAuthorizedRole(appMetadataRole: unknown, activeMembershipRole: unknown, trustedProfileRole?: unknown): Profile["role"] | null {
  // Legacy platform owners are stored in profiles, whose role is server-managed.
  if (appMetadataRole === "MASTER" || trustedProfileRole === "MASTER") return "MASTER"
  return COMPANY_ROLES.has(activeMembershipRole as Profile["role"])
    ? activeMembershipRole as Profile["role"]
    : null
}
