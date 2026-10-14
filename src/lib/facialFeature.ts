/** Enable only after the v2 schema, private service and calibrated models are ready. */
export function isFacialV2Enabled(): boolean {
  return process.env.FACIAL_V2_ENABLED === "true"
}
