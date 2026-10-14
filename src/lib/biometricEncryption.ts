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

export const FACIAL_KEY_VERSION = "v2"
export type FacialTemplateScope = { companyId: string; employeeId: string; modelId: string }

function facialAad(scope: FacialTemplateScope) {
  if (!scope.companyId || !scope.employeeId || !scope.modelId) throw new Error("Contexto biométrico incompleto.")
  return Buffer.from(JSON.stringify([FACIAL_KEY_VERSION, scope.companyId, scope.employeeId, scope.modelId]), "utf8")
}

function validateFacialTemplate(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length !== 128
    || value.some(item => typeof item !== "number" || !Number.isFinite(item) || Math.abs(item) > 100)
    || !value.some(item => Math.abs(item) > 1e-12)) {
    throw new Error("Template SFace inválido. Faça um novo cadastro supervisionado.")
  }
}

export function encryptFacialTemplate(template: number[], scope: FacialTemplateScope) {
  validateFacialTemplate(template)
  const aad = facialAad(scope)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  cipher.setAAD(aad)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(template), "utf8"), cipher.final()])
  return [FACIAL_KEY_VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".")
}

export function decryptFacialTemplate(encrypted: string, scope: FacialTemplateScope) {
  const [version, iv, tag, ciphertext, extra] = encrypted.split(".")
  if (version !== FACIAL_KEY_VERSION || !iv || !tag || !ciphertext || extra
    || Buffer.from(iv, "base64url").length !== IV_BYTES || Buffer.from(tag, "base64url").length !== 16) {
    throw new Error("Formato de template facial inválido.")
  }
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(iv, "base64url"))
  decipher.setAAD(facialAad(scope))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()])
  const template: unknown = JSON.parse(plain.toString("utf8"))
  validateFacialTemplate(template)
  return template
}
