import { z } from "zod";
import { projectsRepository } from "../../../../../src/server/db/project-repository";
import { json, jsonBody } from "../../../../../src/server/http";
import { verifySolanaMessage } from "../../../../../src/server/solana/verify";

const Body = z.object({
  challengeId: z.string().min(8).max(100),
  address: z.string().min(32).max(64),
  signature: z.string().min(20).max(200),
  instruction: z.string().trim().min(3).max(180),
  influence: z.number().positive().max(1000000),
});

export async function POST(
  request: Request,
  context: { params: Record<string, string> },
) {
  try {
    const projectId = context.params.id;
    const body = Body.parse(await jsonBody(request));
    const challenge = projectsRepository.steeringChallenge(
      projectId,
      body.challengeId,
      body.address,
    );
    if (!challenge || challenge.usedAt || challenge.expiresAt < Date.now())
      return json({ error: "challenge expired" }, 409);
    if (!verifySolanaMessage(body.address, challenge.message, body.signature))
      return json({ error: "invalid signature" }, 401);
    const steering = projectsRepository.submitSteering({
      projectId,
      challengeId: body.challengeId,
      address: body.address,
      instruction: body.instruction,
      influence: body.influence,
    });
    projectsRepository.event(
      projectId,
      "supporter.steered",
      `${body.address.slice(0, 4)}…${body.address.slice(-4)} steered the next milestone.`,
    );
    return json({ steering }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "steering failed";
    return json({ error: message }, error instanceof z.ZodError ? 400 : 409);
  }
}
