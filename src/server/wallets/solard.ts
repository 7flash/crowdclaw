import { Solard, sol } from "@solard/sdk";
import { measure } from "measure-fn";
import { solanaRpcUrl, treasuryWalletName } from "../config";

let instance: Solard | null = null;

function sdk(): Solard {
  if (!instance) {
    instance = new Solard({ rpcUrl: solanaRpcUrl() });
  }
  return instance;
}

export async function createProjectWallet(projectId: string): Promise<string> {
  return await measure(
    {
      start: () => "Create project wallet",
      end: (address: string) => ({ address }),
      projectId,
    },
    async () => {
      const wallet = await measure(
        {
          start: () => "Solard create wallet",
          end: (value: any) => ({ address: String(value?.address || "") }),
          wallet: `crowdclaw-${projectId}`,
        },
        () => sdk().createWallet(`crowdclaw-${projectId}`),
      );
      if (!wallet?.address)
        throw new Error("Solard did not return a wallet address");
      return String(wallet.address);
    },
  );
}

export type TreasuryWallet = { name: string; address: string };

export async function getTreasuryWallet(): Promise<TreasuryWallet> {
  return await measure(
    {
      start: () => "Resolve treasury wallet",
      end: (wallet: TreasuryWallet) => wallet,
      walletName: treasuryWalletName(),
    },
    async () => {
      const wanted = treasuryWalletName();
      const wallets = (await measure(
        {
          start: () => "Solard list wallets",
          end: (value: any[]) => ({
            count: Array.isArray(value) ? value.length : 0,
          }),
        },
        () => sdk().listWallets(),
      )) as any[];
      const existing = wallets.find(
        (wallet) =>
          wallet?.name === wanted ||
          wallet?.wallet === wanted ||
          wallet?.address === wanted,
      );
      if (existing?.address) {
        return {
          name: String(existing.name || existing.wallet || wanted),
          address: String(existing.address),
        };
      }
      throw new Error(`Solard treasury wallet not found: ${wanted}`);
    },
  );
}

export async function sendTreasurySol(
  toAddress: string,
  lamports: number,
): Promise<{ fromAddress: string; signature: string }> {
  if (!Number.isFinite(lamports) || lamports <= 0)
    throw new Error("treasury transfer amount must be positive");
  const treasury = await getTreasuryWallet();
  const amount = lamportsToSolString(lamports);
  const sent = await measure(
    {
      start: () => "Send treasury SOL",
      end: (value: any) => ({ signature: extractSignature(value) }),
      from: treasury.address,
      to: toAddress,
      lamports,
    },
    () =>
      sdk()
        .tx(treasury.address)
        .transferSol(toAddress, sol(amount))
        .send() as Promise<any>,
  );
  const signature = extractSignature(sent);
  if (!signature)
    throw new Error("Solard transfer returned no transaction signature");
  return { fromAddress: treasury.address, signature };
}

function lamportsToSolString(lamports: number): string {
  const whole = Math.floor(lamports / 1_000_000_000);
  const fraction = String(Math.floor(lamports % 1_000_000_000))
    .padStart(9, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function extractSignature(result: any): string {
  if (typeof result === "string") return result;
  const value =
    result?.signature ||
    result?.txid ||
    result?.transactionSignature ||
    result?.id ||
    "";
  return String(value || "");
}
