import crypto from "crypto";

// AES-256-GCM encryption for storing Gmail refresh tokens at rest.
// ENCRYPTION_KEY must be a 32-byte value, provided as a 64-char hex string.
function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY env var must be set to a 64-character hex string (32 bytes). " +
        "Generate one with: openssl rand -hex 32"
    );
  }
  return Buffer.from(key, "hex");
}

export function encrypt(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(".");
}

export function decrypt(payload: string): string {
  const [ivHex, authTagHex, dataHex] = payload.split(".");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
