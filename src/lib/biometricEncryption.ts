import "server-only"

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const KEY_BYTES = 32
const IV_BYTES = 12
const FORMAT_VERSION = "v1"

export class BiometricEncryptionConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BiometricEncryptionConfigurationError"
  }
}

function getEncryptionKey() {
  const configured = process.env.BIOMETRIC_ENCRYPTION_KEY || ""
  let key: Buffer
  try {
    key = Buffer.from(configured, "base64")
  } catch {
    throw new BiometricEncryptionConfigurationError("BIOMETRIC_ENCRYPTION_KEY invalida.")
  }
  if (key.byteLength !== KEY_BYTES || key.toString("base64").replace(/=+$/, "") !== configured.replace(/=+$/, "")) {
    throw new BiometricEncryptionConfigurationError("BIOMETRIC_ENCRYPTION_KEY deve ser uma chave base64 de 32 bytes.")
  }
  return key
}

function validateDescriptor(value: unknown): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length !== 512 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item) || Math.abs(item) > 100)
  ) {
    throw new Error("Descritor biometrico invalido.")
  }
}

export function encryptBiometricDescriptor(descriptor: number[], companyId: string) {
  validateDescriptor(descriptor)
  if (!companyId) throw new Error("Empresa obrigatoria para criptografar biometria.")

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  cipher.setAAD(Buffer.from(companyId, "utf8"))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(descriptor), "utf8"),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

export function decryptBiometricDescriptor(encrypted: string, companyId: string) {
  const [version, ivValue, tagValue, ciphertextValue, extra] = encrypted.split(".")
  if (version !== FORMAT_VERSION || !ivValue || !tagValue || !ciphertextValue || extra) {
    throw new Error("Formato de biometria criptografada invalido.")
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivValue, "base64url"))
  decipher.setAAD(Buffer.from(companyId, "utf8"))
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8")
  const descriptor = JSON.parse(plaintext) as unknown
  validateDescriptor(descriptor)
  return descriptor
}

export const BIOMETRIC_KEY_VERSION = FORMAT_VERSION
