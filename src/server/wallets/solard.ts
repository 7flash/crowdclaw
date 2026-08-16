import { Solard } from "@solard/sdk";
import { measure } from "measure-fn";

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
