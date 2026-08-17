import { measure } from "measure-fn";
import {
  lamportsPerCredit,
  treasuryRetryMs,
  treasurySeedEnabled,
} from "../config";
import { projectsRepository } from "../db/project-repository";
import { getTreasuryWallet, sendTreasurySol } from "../wallets/solard";
import { getBalanceLamports } from "../wallets/solana-rpc";
import { log } from "../log";
import type { Project, TreasuryGrant } from "../../shared/types";

export async function ensureFirstMilestoneSeed(
  project: Project,
): Promise<TreasuryGrant | null> {
  if (!treasurySeedEnabled() || project.done !== 0) return null;
  const first = project.milestones[0];
  if (!first) return null;

  return await measure(
    {
      start: () => "Ensure first seed",
      end: (grant: TreasuryGrant | null) => ({
        status: grant?.status || "unavailable",
        lamports: grant?.lamports || 0,
        signature: grant?.signature || "",
      }),
      projectId: project.id,
      wallet: project.walletAddress,
    },
    async () => {
      const requiredLamports = Math.max(
        1,
        Math.ceil(first.costCredits * lamportsPerCredit()),
      );
      const shortfall = Math.max(
        0,
        requiredLamports -
          Math.max(project.creditedLamports, project.onchainLamports),
      );
      const existing = projectsRepository.treasuryGrant(project.id);

      if (shortfall <= 0) {
        if (existing && existing.status !== "confirmed")
          projectsRepository.confirmTreasuryGrant(project.id);
        return projectsRepository.treasuryGrant(project.id);
      }

      if (existing?.status === "submitted") return existing;
      if (existing?.status === "confirmed") return existing;
      if (
        existing?.status === "pending" &&
        Date.now() - existing.updatedAt < treasuryRetryMs()
      )
        return existing;
      if (
        existing?.status === "failed" &&
        Date.now() - existing.updatedAt < treasuryRetryMs()
      )
        return null;

      // A project is never allowed to manufacture its own sponsor. The treasury
      // must already exist in Solard and have enough on-chain SOL for this seed.
      // If it is missing/empty, simply leave the project waiting for funding.
      let treasury;
      try {
        treasury = await getTreasuryWallet();
      } catch (error) {
        log("warn", "treasury.unavailable", {
          projectId: project.id,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      }

      let treasuryBalance = 0;
      try {
        treasuryBalance = await measure(
          {
            start: () => "Treasury seed balance",
            end: (lamports: number) => ({ lamports }),
            projectId: project.id,
            address: treasury.address,
          },
          () => getBalanceLamports(treasury.address),
        );
      } catch (error) {
        log("warn", "treasury.balance_unavailable", {
          projectId: project.id,
          address: treasury.address,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      }

      if (treasuryBalance < shortfall) {
        log("warn", "treasury.insufficient", {
          projectId: project.id,
          address: treasury.address,
          balanceLamports: treasuryBalance,
          requiredLamports: shortfall,
        });
        return null;
      }

      // Only create a visible grant once there is a real funded treasury and we
      // are actually about to submit the transaction.
      projectsRepository.beginTreasuryGrant({
        projectId: project.id,
        toAddress: project.walletAddress,
        lamports: shortfall,
      });

      try {
        const sent = await measure(
          {
            start: () => "Seed first milestone",
            end: (value: { fromAddress: string; signature: string }) => ({
              signature: value.signature,
            }),
            projectId: project.id,
            to: project.walletAddress,
            lamports: shortfall,
          },
          () => sendTreasurySol(project.walletAddress, shortfall),
        );
        const submitted = projectsRepository.submitTreasuryGrant(
          project.id,
          sent.fromAddress,
          sent.signature,
        );
        projectsRepository.event(
          project.id,
          "treasury.seed.sent",
          `CrowdClaw sent ${(shortfall / 1_000_000_000).toFixed(4)} SOL.`,
        );
        return submitted;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        projectsRepository.failTreasuryGrant(project.id, message);
        // Keep this in operator logs. Funding-side infrastructure failure is not
        // an agent/project ERROR in the public activity stream.
        log("warn", "treasury.seed.send_failed", {
          projectId: project.id,
          reason: message,
        });
        return null;
      }
    },
  );
}
