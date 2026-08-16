import { BrandBar } from "../../../src/client/components/BrandBar";
import {
  ProjectApp,
  type ProjectActions,
} from "../../../src/client/components/ProjectApp";
import { projectsRepository } from "../../../src/server/db/project-repository";

const noop = () => {};
const actions: ProjectActions = {
  setTab: noop,
  selectVersion: noop,
  copyWallet: noop,
  syncFunding: noop,
  devFund: noop,
  share: noop,
};

export default function ProjectPage({
  params,
}: {
  params: Record<string, string>;
}) {
  const bundle = projectsRepository.bundle(params.id);
  if (!bundle) {
    return (
      <main className="cc min-h-screen">
        <BrandBar />
        <div className="mx-auto max-w-[660px] px-5 py-24 text-center">
          <div className="font-display text-[42px] font-extrabold uppercase">
            Project not found
          </div>
          <p className="mt-3 text-sm text-[var(--dim)]">
            This CrowdClaw project does not exist or was removed.
          </p>
          <a
            className="cc-btn cc-btn-primary mt-6 inline-block no-underline"
            href="/"
          >
            back home
          </a>
        </div>
      </main>
    );
  }

  return (
    <main
      id="crowdclaw-project"
      data-bundle={JSON.stringify(bundle)}
      className="min-h-screen bg-[var(--void)] text-[var(--bone)]"
    >
      <ProjectApp
        bundle={bundle}
        refreshing={false}
        liveState="connecting"
        error={null}
        tab="play"
        selectedVersion={null}
        artifactCode={null}
        artifactCodeVersion={null}
        toast={null}
        actions={actions}
      />
    </main>
  );
}
