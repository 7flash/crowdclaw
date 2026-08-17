import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "solard.ts"), "utf8");

describe("Solard RPC configuration", () => {
  test("passes CrowdClaw SOLANA_RPC_URL into Solard", () => {
    expect(source).toContain("new Solard({ rpcUrl: solanaRpcUrl() })");
  });

  test("does not rely on Solard-only RPC_ENDPOINT", () => {
    expect(source).not.toContain("process.env.RPC_ENDPOINT");
  });
});
