import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("home creation flow", () => {
  const source = readFileSync("src/client/components/HomeView.tsx", "utf8");
  const tick = readFileSync("src/server/worker/tick-project.ts", "utf8");

  test("shows the agreed title only before planning", () => {
    expect(source).toContain("!planning ? (");
    expect(source).toContain("Describe your <em");
    expect(source).toContain("<Planning");
  });

  test("makes the ten character minimum visible", () => {
    expect(source).toContain("{props.draft.trim().length}/10");
    expect(source).toContain("props.draft.trim().length < 10");
  });

  test("has meaningful progress before the model result", () => {
    expect(source).toContain('"ASSIGNING"');
    expect(source).toContain('"READING IDEA"');
    expect(source).toContain('"FINDING LOOP"');
    expect(source).toContain("planProgress(stage)");
    expect(tick).toContain("startPlanningPulse(project.id, run.id)");
    expect(tick).toContain("revealPlanningResult(project.id, run.id");
  });
});

describe("first release handoff", () => {
  const project = readFileSync("src/client/components/ProjectView.tsx", "utf8");
  const agent = readFileSync("src/server/agent/jsx-agent.tsx", "utf8");

  test("gives seeding its own visible stage", () => {
    expect(project).toContain('project.status === "seeding"');
    expect(project).toContain("<SeedSurface");
    expect(project).toContain("CrowdClaw");
    expect(project).toContain("CONFIRMING");
  });

  test("publishes real activity before the first model response", () => {
    expect(agent).toContain('note: "FILES"');
  });
});
