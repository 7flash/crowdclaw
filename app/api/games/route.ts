import { measure } from "measure-fn";
import { gamesRepository } from "../../../src/server/db/games-repository";
import { json } from "../../../src/server/http";

export async function GET() {
  const games = await measure("api.games.list", async (m) => {
    return await m("db.games.list", () => gamesRepository.list());
  });
  return json(games || []);
}
