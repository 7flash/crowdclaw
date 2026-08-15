import { db } from "./database";
import type { Game, Milestone, Version } from "../../shared/types";

const round2 = (value: number) => Math.round(value * 100) / 100;

function gameFromRow(row: any): Game {
  return {
    id: row.gameId,
    name: row.name,
    prompt: row.prompt,
    summary: row.summary,
    miles: (row.miles || []) as Milestone[],
    done: row.done || 0,
    pool: Number(row.pool || 0),
    spent: Number(row.spent || 0),
    creator: row.creator,
    at: row.at,
  };
}

function versionFromRow(row: any): Version {
  return { n: row.n, code: row.code, at: row.at, by: row.by };
}

function rowByGameId(gameId: string): any | null {
  return db.games.select().where({ gameId }).first() as any | null;
}

export const gamesRepository = {
  list(): Game[] {
    const rows = db.games
      .select()
      .orderBy("at", "DESC")
      .limit(30)
      .all() as any[];
    return rows.map(gameFromRow);
  },

  get(gameId: string): Game | null {
    const row = rowByGameId(gameId);
    return row ? gameFromRow(row) : null;
  },

  versions(gameId: string): Version[] {
    const rows = db.versions
      .select()
      .where({ gameId })
      .orderBy("n", "ASC")
      .all() as any[];
    return rows.map(versionFromRow);
  },

  create(input: Omit<Game, "id"> & { id?: string }): Game {
    const gameId =
      input.id ||
      `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const row = db.games.insert({
      gameId,
      name: input.name,
      prompt: input.prompt,
      summary: input.summary,
      miles: input.miles,
      done: input.done,
      pool: input.pool,
      spent: input.spent,
      creator: input.creator,
      at: input.at,
    }) as any;
    return gameFromRow(row);
  },

  addFunds(gameId: string, amount: number): Game | null {
    let result: Game | null = null;
    db.transaction(() => {
      const row = rowByGameId(gameId);
      if (!row) return;
      row.pool = round2(Number(row.pool || 0) + amount);
      result = gameFromRow(row);
    });
    return result;
  },

  ship(
    gameId: string,
    expectedDone: number,
    cost: number,
    miles: Milestone[],
    version: Version,
  ): Game {
    let result: Game | null = null;
    db.transaction(() => {
      const row = rowByGameId(gameId);
      if (!row) throw new Error("game not found");
      if ((row.done || 0) !== expectedDone)
        throw new Error("game advanced while this build was running");
      if (Number(row.pool || 0) - Number(row.spent || 0) < cost)
        throw new Error("milestone is no longer funded");

      db.versions.insert({ gameId, ...version });
      row.done = expectedDone + 1;
      row.miles = miles;
      row.spent = round2(Number(row.spent || 0) + cost);
      result = gameFromRow(row);

      const versions = db.versions
        .select()
        .where({ gameId })
        .orderBy("n", "DESC")
        .all() as any[];
      for (const old of versions.slice(4)) db.versions.delete(old.id);
    });
    if (!result) throw new Error("failed to persist shipped milestone");
    return result;
  },
};
