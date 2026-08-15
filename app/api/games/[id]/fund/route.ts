import { z } from "zod";
import { measure } from "measure-fn";
import { gamesRepository } from "../../../../../src/server/db/games-repository";
import { json, jsonBody, walletFrom } from "../../../../../src/server/http";

const Body = z.object({ amount: z.number().finite().positive() });

export async function POST(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  try {
    walletFrom(request);
    const { amount } = Body.parse(await jsonBody(request));
    const game = await measure(
      { label: "api.game.fund", gameId: params.id, amount },
      async (m) => {
        return await m("db.game.add-funds", () =>
          gamesRepository.addFunds(params.id, amount),
        );
      },
    );
    return game ? json({ game }) : json({ error: "game not found" }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "invalid request" },
      400,
    );
  }
}
