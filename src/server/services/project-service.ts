import { measure } from "measure-fn";
import { projectsRepository } from "../db/project-repository";
import { createProjectWallet } from "../wallets/solard";
import type { Project, ProjectBundle } from "../../shared/types";

function projectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function createProject(idea: string): Promise<Project> {
  const id = projectId();
  const project = await measure(
    { label: "project.create", projectId: id, ideaChars: idea.length },
    async () => {
      const walletAddress = await measure("wallet.create", () =>
        createProjectWallet(id),
      );
      if (!walletAddress) throw new Error("failed to provision project wallet");
      const created = await measure("db.project.create", () =>
        projectsRepository.create({ projectId: id, idea, walletAddress }),
      );
      if (!created) throw new Error("failed to persist project");
      await measure("db.event.created", () =>
        projectsRepository.event(
          id,
          "project.created",
          "Idea created; autonomous agent assigned.",
        ),
      );
      await measure("db.event.wallet", () =>
        projectsRepository.event(
          id,
          "wallet.created",
          `Funding wallet ${walletAddress} created.`,
        ),
      );
      return created;
    },
  );
  if (!project) throw new Error("project creation failed");
  return project;
}

export async function getProjectBundle(
  projectId: string,
): Promise<ProjectBundle | null> {
  return await measure({ label: "project.bundle", projectId }, async () => {
    return await measure("db.project.bundle", () =>
      projectsRepository.bundle(projectId),
    );
  });
}
