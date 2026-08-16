import { createPublicKey, verify } from "node:crypto";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const indexes = new Map([...alphabet].map((char, index) => [char, index]));
const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");

export function decodeBase58(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  const bytes = [0];
  for (const char of value) {
    const digit = indexes.get(char);
    if (digit == null) throw new Error("invalid base58");
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < value.length - 1 && value[i] === "1"; i += 1)
    bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

export function verifySolanaMessage(
  address: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const raw = decodeBase58(address);
    if (raw.length !== 32) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([ed25519SpkiPrefix, Buffer.from(raw)]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(message, "utf8"),
      publicKey,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}
