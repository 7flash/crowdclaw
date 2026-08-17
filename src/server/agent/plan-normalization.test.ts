import { describe, expect, test } from "bun:test";
import { normalizePlan } from "./jsx-agent";

describe("one-step plan normalization", () => {
  test("repairs presentation details instead of rejecting the only tool turn", () => {
    const plan = normalizePlan(
      {
        slug: "Signal Runner!!!",
        summary: "run",
        note: "Make it fast and fun with very readable action feedback please",
        milestones: [
          { title: "Core", goal: "Playable movement and restart", cost: 99 },
          { title: "Juice", goal: "Better feedback", cost: "2" },
        ],
      } as any,
      "signal runner",
    );

    expect(plan.slug).toBe("signal-runner");
    expect(plan.milestones).toHaveLength(3);
    expect(plan.milestones[0].costCredits).toBe(4);
    expect(plan.milestones[1].costCredits).toBe(2);
    expect(plan.note.split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  test("rejects only plans with no usable milestone semantics", () => {
    expect(() => normalizePlan({ milestones: [] } as any, "game")).toThrow(
      "no usable milestones",
    );
  });
});
