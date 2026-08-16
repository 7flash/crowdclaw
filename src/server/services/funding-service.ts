import { measure } from "measure-fn";
import { projectsRepository } from "../db/project-repository";
import { getBalanceLamports } from "../wallets/solana-rpc";
import type { Project } from "../../shared/types";

export async function syncProjectFunding(
  project: Project,
  force = false,
): Promise<Project> {
  const interval =
    Number.parseInt(process.env.FUNDING_SYNC_MS || "15000", 10) || 15000;
  if (!force && Date.now() - project.lastFundingSyncAt < interval)
    return project;

  try {
    const updated = await measure(
      { label: "funding.sync", projectId: project.id },
      async (m) => {
        const lamports = await m("wallet.balance", () =>
          getBalanceLamports(project.walletAddress),
        );
        if (lamports == null) throw new Error("wallet balance unavailable");
        return await m("db.funding.store", () =>
          projectsRepository.setFunding(project.id, lamports),
        );
      },
    );
    return updated || project;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "funding sync failed";
    projectsRepository.setFundingError(project.id, message);
    return projectsRepository.get(project.id) || project;
  }
}
