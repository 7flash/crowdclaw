import { measure } from "measure-fn";
import { abortScope } from "../abort";
import { solanaRpcTimeoutMs, solanaRpcUrl } from "../config";

type SignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
};

type ParsedAccountKey =
  string | { pubkey?: string; signer?: boolean; writable?: boolean };

type TransactionResult = {
  slot?: number;
  blockTime?: number | null;
  transaction?: {
    message?: {
      accountKeys?: ParsedAccountKey[];
    };
  };
  meta?: {
    preBalances?: number[];
    postBalances?: number[];
  } | null;
} | null;

export type InboundTransfer = {
  signature: string;
  fromAddress: string;
  lamports: number;
  slot: number;
  blockTime: number;
};

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const scope = abortScope(solanaRpcTimeoutMs());
  try {
    const response = await fetch(solanaRpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: scope.signal,
    });
    if (!response.ok) throw new Error(`Solana RPC returned ${response.status}`);
    const body = (await response.json()) as {
      result?: T;
      error?: { message?: string };
    };
    if (body.error) throw new Error(body.error.message || "Solana RPC error");
    return body.result as T;
  } finally {
    scope.close();
  }
}

export async function getBalanceLamports(address: string): Promise<number> {
  const result = await measure(
    { label: "solana.balance", address },
    async (m) => {
      const body = await m("rpc.getBalance", () =>
        rpc<{ value?: number }>("getBalance", [
          address,
          { commitment: "confirmed" },
        ]),
      );
      const value = body?.value;
      if (!Number.isFinite(value) || (value as number) < 0)
        throw new Error("Solana RPC returned an invalid balance");
      return Math.floor(value as number);
    },
  );
  if (result == null) throw new Error("failed to read project wallet balance");
  return result;
}

export async function getRecentInboundTransfers(
  address: string,
  knownSignatures: ReadonlySet<string>,
  limit = 24,
): Promise<InboundTransfer[]> {
  const result = await measure(
    { label: "solana.inbound-transfers", address },
    async (m) => {
      const signatures = await m("rpc.getSignaturesForAddress", () =>
        rpc<SignatureInfo[]>("getSignaturesForAddress", [
          address,
          { limit: Math.max(1, Math.min(50, limit)), commitment: "confirmed" },
        ]),
      );
      const candidates = (signatures || [])
        .filter(
          (item) =>
            item &&
            !item.err &&
            item.signature &&
            !knownSignatures.has(item.signature),
        )
        .slice(0, 12);

      const transfers: InboundTransfer[] = [];
      for (const item of candidates) {
        const tx = await m("rpc.getTransaction", () =>
          rpc<TransactionResult>("getTransaction", [
            item.signature,
            {
              commitment: "confirmed",
              encoding: "jsonParsed",
              maxSupportedTransactionVersion: 0,
            },
          ]),
        );
        const transfer = inboundFromTransaction(address, item, tx);
        if (transfer) transfers.push(transfer);
      }
      return transfers;
    },
  );
  return result || [];
}

export function inboundFromTransaction(
  address: string,
  signature: SignatureInfo,
  tx: TransactionResult,
): InboundTransfer | null {
  const keys = tx?.transaction?.message?.accountKeys || [];
  const pre = tx?.meta?.preBalances || [];
  const post = tx?.meta?.postBalances || [];
  if (!keys.length || pre.length !== post.length || pre.length !== keys.length)
    return null;

  const normalized = keys.map((key) =>
    typeof key === "string"
      ? { pubkey: key, signer: false }
      : { pubkey: key.pubkey || "", signer: Boolean(key.signer) },
  );
  const recipientIndex = normalized.findIndex((key) => key.pubkey === address);
  if (recipientIndex < 0) return null;
  const lamports = Math.floor(
    Number(post[recipientIndex] || 0) - Number(pre[recipientIndex] || 0),
  );
  if (lamports <= 0) return null;

  const debits = normalized
    .map((key, index) => ({
      key,
      index,
      debit: Number(pre[index] || 0) - Number(post[index] || 0),
    }))
    .filter(
      (item) =>
        item.index !== recipientIndex && item.key.pubkey && item.debit > 0,
    );
  const signer = debits
    .filter((item) => item.key.signer)
    .sort((a, b) => b.debit - a.debit)[0];
  const fallback = debits.sort((a, b) => b.debit - a.debit)[0];
  const fromAddress = signer?.key.pubkey || fallback?.key.pubkey || "unknown";

  return {
    signature: signature.signature,
    fromAddress,
    lamports,
    slot: Math.floor(Number(tx?.slot || signature.slot || 0)),
    blockTime: Math.floor(Number(tx?.blockTime || signature.blockTime || 0)),
  };
}
