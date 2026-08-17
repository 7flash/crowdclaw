import { Solard, sol } from "@solard/sdk";
import { measure } from "measure-fn";
import { treasuryAutoCreate, treasuryWalletName } from "../config";

let instance: Solard | null = null;

function sdk(): Solard {
  if (!instance) instance = new Solard();
  return instance;
}

export async function createProjectWallet(projectId: string): Promise<string> {
  const address = await measure("wallet.project.create", async () => {
    const wallet = await measure("solard.create-wallet", () =>
      sdk().createWallet(`crowdclaw-${projectId}`),
    );
    if (!wallet?.address)
      throw new Error("Solard did not return a wallet address");
    return wallet.address;
  });
  if (!address) throw new Error("failed to create project wallet");
  return address;
}

export type TreasuryWallet = { name: string; address: string };

export async function getTreasuryWallet(): Promise<TreasuryWallet> {
  return await measure("wallet.treasury.resolve", async () => {
    const wanted = treasuryWalletName();
    const wallets = (await measure("solard.list-wallets", () =>
      sdk().listWallets(),
    )) as any[];
    const existing = wallets.find(
      (wallet) =>
        wallet?.name === wanted ||
        wallet?.wallet === wanted ||
        wallet?.address === wanted,
    );
    if (existing?.address)
      return {
        name: String(existing.name || existing.wallet || wanted),
        address: String(existing.address),
      };
    if (!treasuryAutoCreate())
      throw new Error(`Solard treasury wallet not found: ${wanted}`);
    const created = (await measure("solard.create-treasury", () =>
      sdk().createWallet(wanted),
    )) as any;
    if (!created?.address)
      throw new Error("Solard did not return a treasury wallet address");
    return {
      name: String(created.name || wanted),
      address: String(created.address),
    };
  });
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
    "solard.treasury.transfer",
    () =>
      sdk()
        .tx(treasury.address)
        .transferSol(toAddress, sol(amount))
        .send() as Promise<any>,
  );
  const signature = extractSignature(sent);
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
