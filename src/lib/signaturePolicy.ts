/** New biometric operations are retired; historical evidence stays readable. */
export function isBiometricOperationAllowed(operation: string): boolean {
  return operation === "delete"
}
