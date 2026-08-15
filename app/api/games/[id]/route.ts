import { measure } from "measure-fn";
import { gamesRepository } from "../../../../src/server/db/games-repository";
import { json } from "../../../../src/server/http";

export async function GET(
  _request: Request,
  { params }: { params: Record<string, string> },
) {
  const bundle = await measure(
    { label: "api.game.get", gameId: params.id },
    async (m) => {
      const game = await m("db.game.get", () => gamesRepository.get(params.id));
      if (!game) return null;
      const versions = await m("db.versions.list", () =>
        gamesRepository.versions(params.id),
      );
      return { game, versions: versions || [] };
    },
  );
  return bundle ? json(bundle) : json({ error: "game not found" }, 404);
}
