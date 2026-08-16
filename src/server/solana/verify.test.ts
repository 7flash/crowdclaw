import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifySolanaMessage } from "./verify";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  if (!bytes.length) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeros = 0;
  while (zeros < bytes.length - 1 && bytes[zeros] === 0) zeros += 1;
  return (
    "1".repeat(zeros) +
    digits
      .reverse()
      .map((digit) => alphabet[digit])
      .join("")
  );
}

describe("Solana steering signatures", () => {
  test("verifies an Ed25519 signature against a base58 public key", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ format: "der", type: "spki" }) as Uint8Array;
    const address = encodeBase58(der.subarray(-32));
    const message =
      "CrowdClaw steer\nproject:p_test_abc\naddress:test\nnonce:1";
    const signature = sign(null, Buffer.from(message), privateKey).toString(
      "base64",
    );
    expect(verifySolanaMessage(address, message, signature)).toBe(true);
    expect(verifySolanaMessage(address, `${message}!`, signature)).toBe(false);
  });
});
