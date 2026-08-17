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
  setSteerText: noop,
  setSteerAmount: noop,
  steer: noop,
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
            NOT FOUND
          </div>
          <a className="cc-btn mt-6 inline-block no-underline" href="/">
            ←
          </a>
        </div>
      </main>
    );
  }

  return (
    <div
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
        steerText=""
        steerAmount="1"
        steering={false}
        actions={actions}
      />
    </div>
  );
}
