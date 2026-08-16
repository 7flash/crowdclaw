import { measure } from "measure-fn";
import { fundingSyncMs, lamportsPerCredit } from "../config";
import { projectsRepository } from "../db/project-repository";
import { log } from "../log";
import {
  getBalanceLamports,
  getRecentInboundTransfers,
} from "../wallets/solana-rpc";
import type { Project } from "../../shared/types";

export async function syncProjectFunding(
  project: Project,
  force = false,
): Promise<Project> {
  if (!force && Date.now() - project.lastFundingSyncAt < fundingSyncMs())
    return project;

  try {
    const result = await measure("funding.sync", async () => {
      const lamports = await measure("wallet.balance", () =>
        getBalanceLamports(project.walletAddress),
      );
      const stored = await measure("db.funding.store", () =>
        projectsRepository.setFunding(project.id, lamports),
      );
      if (!stored) throw new Error("project disappeared during funding sync");

      try {
        const known = new Set(
          projectsRepository.donationSignatures(project.id, 200),
        );
        const transfers = await measure("wallet.inbound.index", () =>
          getRecentInboundTransfers(project.walletAddress, known),
        );
        const inserted = await measure("db.donations.store", () =>
          projectsRepository.recordDonations(project.id, transfers),
        );
        for (const donation of inserted) {
          projectsRepository.event(
            project.id,
            "funding.donation",
            `Indexed ${donation.credits.toFixed(2)} build credits of inbound SOL from ${short(donation.fromAddress)}.`,
          );
        }
      } catch (error) {
        log("warn", "funding.donation_index_failed", {
          projectId: project.id,
          error,
        });
      }

      return stored;
    });
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

function short(address: string): string {
  if (!address || address === "unknown") return "unknown wallet";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
