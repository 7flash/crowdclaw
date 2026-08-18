import { measure } from "measure-fn";
import { fundingSyncMs, lamportsPerCredit } from "../config";
import { projectsRepository } from "../db/project-repository";
import { log } from "../log";
import { publishNotification } from "../notification-feed";
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

  return await measure(
    {
      start: () => "Funding sync",
      end: (value: Project) => ({
        status: value.status,
        onchainLamports: value.onchainLamports,
        availableCredits: value.availableCredits,
      }),
      projectId: project.id,
      wallet: project.walletAddress,
      catch: (error) => {
        const message =
          error instanceof Error
            ? error.message
            : String(error || "funding sync failed");
        projectsRepository.setFundingError(project.id, message);
        return projectsRepository.get(project.id) || project;
      },
    },
    async () => {
      const lamports = await measure(
        {
          start: () => "Wallet balance",
          end: (value: number) => ({ lamports: value }),
          wallet: project.walletAddress,
        },
        () => getBalanceLamports(project.walletAddress),
      );
      const stored = await measure(
        {
          start: () => "Store funding",
          end: (value: ReturnType<typeof projectsRepository.setFunding>) => ({
            credited: value?.newlyCreditedLamports || 0,
          }),
          projectId: project.id,
        },
        () => projectsRepository.setFunding(project.id, lamports),
      );
      if (!stored) throw new Error("project disappeared during funding sync");

      // Signature indexing is only needed when the wallet balance actually grew.
      // While a project waits for funding we can therefore poll the cheap balance
      // endpoint frequently without also scanning transaction history every tick.
      if (stored.newlyCreditedLamports > 0) {
        try {
          const known = new Set(
            projectsRepository.donationSignatures(project.id, 200),
          );
          const transfers = await measure(
            {
              start: () => "Inbound transfers",
              end: (
                items: Awaited<ReturnType<typeof getRecentInboundTransfers>>,
              ) => ({ count: items.length }),
              projectId: project.id,
            },
            () => getRecentInboundTransfers(project.walletAddress, known),
          );
          const inserted = await measure(
            {
              start: () => "Store donations",
              end: (
                items: ReturnType<typeof projectsRepository.recordDonations>,
              ) => ({ count: items.length }),
              projectId: project.id,
            },
            () => projectsRepository.recordDonations(project.id, transfers),
          );
          for (const donation of inserted) {
            projectsRepository.event(
              project.id,
              "funding.donation",
              `Indexed ${donation.credits.toFixed(2)} build credits of inbound SOL from ${short(donation.fromAddress)}.`,
            );
            publishNotification("donation.received", project.id, {
              projectName: stored.project.name,
              donationId: donation.id,
              signature: donation.signature,
              fromAddress: donation.fromAddress,
              lamports: donation.lamports,
              sol: donation.lamports / 1_000_000_000,
              credits: donation.credits,
              slot: donation.slot,
              blockTime: donation.blockTime,
              source: donation.source,
            });
          }
        } catch (error) {
          log("warn", "funding.donation_index_failed", {
            projectId: project.id,
            error,
          });
        }

        const credits = stored.newlyCreditedLamports / lamportsPerCredit();
        projectsRepository.event(
          project.id,
          "funding.confirmed",
          `Confirmed +${credits.toFixed(2)} build credits from the project wallet.`,
        );
      }
      return stored.project;
    },
  );
}

function short(address: string): string {
  if (!address || address === "unknown") return "unknown wallet";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
