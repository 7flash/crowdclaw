import { render } from "tradjs/client";
import {
  DiscoverView,
  type DiscoverSort,
} from "../../src/client/components/DiscoverView";
import type { Project } from "../../src/shared/types";

export default function mount() {
  const root = document.getElementById("crowdclaw-discover");
  if (!root) return;
  let state = {
    projects: parseProjects(root.dataset.projects),
    query: "",
    sort: "trending" as DiscoverSort,
  };

  const draw = () =>
    render(
      <DiscoverView
        projects={state.projects}
        query={state.query}
        sort={state.sort}
        onQuery={(query) => {
          state.query = query;
          draw();
        }}
        onSort={(sort) => {
          state.sort = sort;
          draw();
        }}
      />,
      root,
    );

  draw();
}

function parseProjects(raw: string | undefined): Project[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}
