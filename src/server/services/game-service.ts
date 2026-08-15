import { measure } from "measure-fn";
import { callOnce, callUntilComplete } from "../agent/anthropic";
import { BUILD_SYS, PLAN_SYS } from "../agent/prompts";
import { parseAgentOutput, sealHtml } from "../agent/output";
import { gamesRepository } from "../db/games-repository";
import type { Game, StreamEvent, Version } from "../../shared/types";

const buildLocks = new Set<string>();

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

export async function planGame(
  prompt: string,
  creator: string,
  send: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const result = await measure(
    { label: "game.plan", promptChars: prompt.length },
    async (m) => {
      const full = requireValue(
        await m("agent.plan", () =>
          callOnce(
            PLAN_SYS,
            [{ role: "user", content: prompt }],
            (text) => send({ type: "stream", text }),
            signal,
          ),
        ),
        "planning failed",
      );
      const parsed = requireValue(
        await m("agent.parse-plan", () => parseAgentOutput(full)),
        "could not parse plan",
      );
      if (parsed.miles.length !== 3)
        throw new Error("the plan must contain exactly three milestones");

      const game = requireValue(
        await m("db.create-game", () =>
          gamesRepository.create({
            name: parsed.name || "untitled",
            prompt,
            summary: parsed.summary || prompt,
            miles: parsed.miles,
            done: 0,
            pool: 0,
            spent: 0,
            creator,
            at: Date.now(),
          }),
        ),
        "failed to save game",
      );

      return game;
    },
  );

  if (!result) throw new Error("planning failed");
  send({ type: "complete", game: result as Game });
}

export async function buildNextMilestone(
  gameId: string,
  actor: string,
  send: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (buildLocks.has(gameId)) throw new Error("this game is already building");
  buildLocks.add(gameId);

  try {
    const result = await measure({ label: "game.build", gameId }, async (m) => {
      const game = requireValue(
        await m("db.load-game", () => gamesRepository.get(gameId)),
        "game not found",
      );
      const k = game.done || 0;
      const milestone = game.miles[k];
      if (!milestone) throw new Error("there is no next milestone");
      if (game.pool - game.spent < milestone.c)
        throw new Error("the next milestone is not funded");

      const versions = requireValue(
        await m("db.load-versions", () => gamesRepository.versions(gameId)),
        "failed to load versions",
      );
      const previous = versions[versions.length - 1];
      const prompt = previous
        ? `Game: ${game.prompt}\n\nMilestone ${k + 1}: ${milestone.t}\n\nCurrent version:\n\n${previous.code}\n\nExtend it to complete this milestone. Return the complete updated file.`
        : `Game: ${game.prompt}\n\nMilestone 1: ${milestone.t}\n\nBuild it. Return the complete file.`;

      const full = requireValue(
        await m("agent.build", () =>
          callUntilComplete(
            BUILD_SYS,
            prompt,
            (text) => {
              send({ type: "stream", text });
              const notes = parseAgentOutput(text).notes;
              if (notes.length)
                send({ type: "say", text: notes[notes.length - 1] });
            },
            signal,
          ),
        ),
        "build failed",
      );

      const parsed = requireValue(
        await m("agent.parse-build", () => parseAgentOutput(full)),
        "could not parse build",
      );
      const sealed = requireValue(
        await m("agent.seal-html", () => sealHtml(parsed.code)),
        "the agent did not return a file",
      );
      if (sealed.length < 300)
        throw new Error("the agent didn't finish a file — nothing charged");

      const grown = [...game.miles];
      if (parsed.miles[0] && grown.length < k + 4) grown.push(parsed.miles[0]);
      const nextMiles = grown.slice(0, 14);
      const version: Version = {
        n: k + 1,
        code: sealed,
        at: Date.now(),
        by: actor,
      };

      const updated = requireValue(
        await m("db.ship-milestone", () =>
          gamesRepository.ship(gameId, k, milestone.c, nextMiles, version),
        ),
        "failed to save build",
      );

      return {
        game: updated,
        version,
        say: parsed.notes[parsed.notes.length - 1] || "",
      };
    });

    if (!result) throw new Error("build failed");
    if (result.say) send({ type: "say", text: result.say });
    send({ type: "complete", game: result.game, version: result.version });
  } finally {
    buildLocks.delete(gameId);
  }
}
