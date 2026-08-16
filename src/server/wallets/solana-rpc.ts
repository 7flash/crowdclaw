import { measure } from "measure-fn";
import { abortScope } from "../abort";
import { solanaRpcTimeoutMs, solanaRpcUrl } from "../config";

export async function getBalanceLamports(address: string): Promise<number> {
  const result = await measure(
    { label: "solana.balance", address },
    async (m) => {
      const scope = abortScope(solanaRpcTimeoutMs());
      try {
        const response = await m("rpc.getBalance", () =>
          fetch(solanaRpcUrl(), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getBalance",
              params: [address, { commitment: "confirmed" }],
            }),
            signal: scope.signal,
          }),
        );
        if (!response?.ok)
          throw new Error(
            `Solana RPC returned ${response?.status || "no response"}`,
          );
        const body = (await response.json()) as {
          result?: { value?: number };
          error?: { message?: string };
        };
        if (body.error)
          throw new Error(body.error.message || "Solana RPC error");
        const value = body.result?.value;
        if (!Number.isFinite(value) || (value as number) < 0)
          throw new Error("Solana RPC returned an invalid balance");
        return Math.floor(value as number);
      } finally {
        scope.close();
      }
    },
  );
  if (result == null) throw new Error("failed to read project wallet balance");
  return result;
}
