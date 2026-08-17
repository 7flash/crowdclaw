import { measure } from "measure-fn";
import { projectsRepository } from "../db/project-repository";
import { createProjectWallet } from "../wallets/solard";
import type { Project, ProjectBundle } from "../../shared/types";

function projectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function createProject(idea: string): Promise<Project> {
  const id = projectId();
  return await measure(
    {
      start: () => "Create project",
      end: (project: Project) => ({
        projectId: project.id,
        status: project.status,
      }),
      projectId: id,
    },
    async () => {
      const walletAddress = await measure(
        {
          start: () => "Create wallet",
          end: (address: string) => ({ address }),
          projectId: id,
        },
        () => createProjectWallet(id),
      );
      if (!walletAddress) throw new Error("failed to provision project wallet");

      const created = await measure(
        {
          start: () => "Persist project",
          end: (project: Project) => ({ projectId: project.id }),
          projectId: id,
        },
        () => projectsRepository.create({ projectId: id, idea, walletAddress }),
      );
      if (!created) throw new Error("failed to persist project");

      await measure(
        {
          start: () => "Event project.created",
          end: () => ({ ok: true }),
          projectId: id,
        },
        () =>
          projectsRepository.event(
            id,
            "project.created",
            "Idea created; autonomous agent assigned.",
          ),
      );
      await measure(
        {
          start: () => "Event wallet.created",
          end: () => ({ ok: true }),
          projectId: id,
        },
        () =>
          projectsRepository.event(
            id,
            "wallet.created",
            `Funding wallet ${walletAddress} created.`,
          ),
      );
      return created;
    },
  );
}

export async function getProjectBundle(
  projectId: string,
): Promise<ProjectBundle | null> {
  return await measure(
    {
      start: () => "Project bundle",
      end: (bundle: ProjectBundle | null) => ({
        found: Boolean(bundle),
        status: bundle?.project.status || null,
      }),
      projectId,
    },
    () => projectsRepository.bundle(projectId),
  );
}
