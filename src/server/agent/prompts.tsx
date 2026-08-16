/** @jsxImportSource ai-jsx */
import * as AI from "ai-jsx";
import type { Milestone, Project } from "../../shared/types";

export const PLAN_SYS_SOURCE = `You plan tiny browser games that get built one milestone at a time, funded by a crowd.

Given a game idea, respond ONLY in this line format, nothing else:
N|kebab-case-name
S|one plain sentence describing the game
M|first milestone|2
M|second milestone|2
M|third milestone|3

Rules:
- Exactly three M lines.
- Titles are 3-7 words, plain, concrete, no numbering, no colons.
- The first milestone must produce something immediately playable — a real loop, not a scaffold.
- Cost is a whole number from 1 to 4.`;

export const BUILD_SYS_SOURCE = `You build tiny, complete, playable browser games as ONE self-contained HTML file, one milestone at a time.

The file:
- One file, inline <style> and <script>. No imports, no CDN, no external requests or fonts.
- Runs instantly on load. No build step. No localStorage.
- Fills its frame: html,body{margin:0;height:100%;overflow:hidden} and size the canvas to window.
- Dark background, high contrast, clean shapes.
- Keyboard AND pointer input, with the controls shown on screen.
- Real loop: score or win/lose, restart without reloading.
- KEEP IT SHORT — about 70 lines. Terse names, no comments, no blank lines. Finishing the file matters far more than features.

Output exactly this and nothing else:
T|one short first-person line on what you're doing for this milestone and why
M|the next milestone you would want after this one|2
CODE|
<!DOCTYPE html>…</html>

The M line is a new milestone you invent, following on from the one you just finished: 3-7 words, concrete, something a player would feel, cost 1 to 4. Nothing after </html>.`;

function PlanSystem() {
  return <>{PLAN_SYS_SOURCE}</>;
}

function PlanUser({ idea }: { idea: string }) {
  return <>{idea}</>;
}

function BuildSystem() {
  return <>{BUILD_SYS_SOURCE}</>;
}

function BuildUser({
  project,
  milestone,
  milestoneNumber,
  previousHtml,
}: {
  project: Project;
  milestone: Milestone;
  milestoneNumber: number;
  previousHtml?: string;
}) {
  if (previousHtml) {
    return (
      <>{`Game: ${project.idea}\n\nMilestone ${milestoneNumber}: ${milestone.title}\n\nCurrent version:\n\n${previousHtml}\n\nExtend it to complete this milestone. Return the complete updated file.`}</>
    );
  }
  return (
    <>{`Game: ${project.idea}\n\nMilestone 1: ${milestone.title}\n\nBuild it. Return the complete file.`}</>
  );
}

async function render(node: any): Promise<string> {
  const context = AI.createRenderContext();
  return String(await context.render(node));
}

export async function renderPlanPrompt(
  idea: string,
): Promise<{ system: string; user: string }> {
  const [system, user] = await Promise.all([
    render(<PlanSystem />),
    render(<PlanUser idea={idea} />),
  ]);
  return { system, user };
}

export async function renderBuildPrompt(
  project: Project,
  milestone: Milestone,
  previousHtml?: string,
): Promise<{ system: string; user: string }> {
  const [system, user] = await Promise.all([
    render(<BuildSystem />),
    render(
      <BuildUser
        project={project}
        milestone={milestone}
        milestoneNumber={project.done + 1}
        previousHtml={previousHtml}
      />,
    ),
  ]);
  return { system, user };
}
