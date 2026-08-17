import { measure } from "measure-fn";
import {
  lamportsPerCredit,
  treasuryRetryMs,
  treasurySeedEnabled,
} from "../config";
import { projectsRepository } from "../db/project-repository";
import { sendTreasurySol } from "../wallets/solard";
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
        status: grant?.status || "none",
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
        return existing;

      const grant = projectsRepository.beginTreasuryGrant({
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
        projectsRepository.event(project.id, "treasury.seed.failed", message);
        throw error;
      }
    },
  );
}
