import { describe, expect, test } from "bun:test";
import { inboundFromTransaction } from "./solana-rpc";

describe("Solana donation indexing", () => {
  test("extracts the project-wallet delta and prefers the paying signer", () => {
    const transfer = inboundFromTransaction(
      "ProjectWallet",
      { signature: "sig-1", slot: 42, err: null, blockTime: 1234 },
      {
        slot: 42,
        blockTime: 1234,
        transaction: {
          message: {
            accountKeys: [
              { pubkey: "DonorWallet", signer: true },
              { pubkey: "ProjectWallet", signer: false },
              { pubkey: "ProgramAccount", signer: false },
            ],
          },
        },
        meta: {
          preBalances: [2_000_005_000, 0, 10],
          postBalances: [1_000_000_000, 1_000_000_000, 10],
        },
      },
    );

    expect(transfer).toEqual({
      signature: "sig-1",
      fromAddress: "DonorWallet",
      lamports: 1_000_000_000,
      slot: 42,
      blockTime: 1234,
    });
  });

  test("ignores transactions that do not increase the project balance", () => {
    const transfer = inboundFromTransaction(
      "ProjectWallet",
      { signature: "sig-2", slot: 43, err: null, blockTime: 1235 },
      {
        transaction: { message: { accountKeys: ["ProjectWallet", "Other"] } },
        meta: { preBalances: [10, 20], postBalances: [5, 25] },
      },
    );
    expect(transfer).toBeNull();
  });
});
