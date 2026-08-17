import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("idea to project handoff", () => {
  test("uses an explicit exit animation before normal document navigation", () => {
    const home = readFileSync("src/client/components/HomeView.tsx", "utf8");
    const client = readFileSync("app/page.client.tsx", "utf8");
    const css = readFileSync("app/globals.css", "utf8");
    expect(home).toContain('id="crowdclaw-created-project-link"');
    expect(client).toContain('root.classList.add("cc-home-handoff-out")');
    expect(client).toContain("window.location.assign(link.href)");
    expect(css).toContain("@keyframes cc-handoff-out");
    expect(css).not.toContain("@view-transition { navigation:auto; }");
  });

  test("animates the project document in and keeps waiting funding out of the stage", () => {
    const page = readFileSync("app/projects/[id]/page.tsx", "utf8");
    const project = readFileSync(
      "src/client/components/ProjectView.tsx",
      "utf8",
    );
    const css = readFileSync("app/globals.css", "utf8");
    expect(page).toContain("cc-project-doc-enter");
    expect(css).toContain("@keyframes cc-project-enter");
    expect(project).toContain(
      "const showStage = Boolean(currentArtifact || buildActive",
    );
    expect(project).not.toContain("<FundingSurface");
    expect(project).not.toContain("function FundingSurface");
  });
});
