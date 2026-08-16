import { liveHealth } from "../../../../src/server/health";
import { json } from "../../../../src/server/http";

export async function GET() {
  return json(liveHealth());
}
