import { measure } from "measure-fn";
import { fundingSyncMs, lamportsPerCredit } from "../config";
import { projectsRepository } from "../db/project-repository";
import { getBalanceLamports } from "../wallets/solana-rpc";
import type { Project } from "../../shared/types";

export async function syncProjectFunding(
  project: Project,
  force = false,
): Promise<Project> {
  if (!force && Date.now() - project.lastFundingSyncAt < fundingSyncMs())
    return project;

  try {
    const result = await measure(
      { label: "funding.sync", projectId: project.id },
      async (m) => {
        const lamports = await m("wallet.balance", () =>
          getBalanceLamports(project.walletAddress),
        );
        const stored = await m("db.funding.store", () =>
          projectsRepository.setFunding(project.id, lamports),
        );
        if (!stored) throw new Error("project disappeared during funding sync");
        return stored;
      },
    );
    if (!result) return project;
    if (result.newlyCreditedLamports > 0) {
      const credits = result.newlyCreditedLamports / lamportsPerCredit();
      projectsRepository.event(
        project.id,
        "funding.confirmed",
        `Confirmed +${credits.toFixed(2)} build credits from the project wallet.`,
      );
    }
    return result.project;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "funding sync failed";
    projectsRepository.setFundingError(project.id, message);
    return projectsRepository.get(project.id) || project;
  }
}
