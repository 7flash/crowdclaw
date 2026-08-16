import { readyHealth } from "../../../../src/server/health";
import { json } from "../../../../src/server/http";

export async function GET() {
  const health = readyHealth();
  return json(health, health.ok ? 200 : 503);
}
