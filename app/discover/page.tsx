import { DiscoverView } from "../../src/client/components/DiscoverView";
import { projectsRepository } from "../../src/server/db/project-repository";

const noop = () => {};

export default function Page() {
  const projects = projectsRepository.list();
  return (
    <div id="crowdclaw-discover" data-projects={JSON.stringify(projects)}>
      <DiscoverView projects={projects} onQuery={noop} onSort={noop} />
    </div>
  );
}
