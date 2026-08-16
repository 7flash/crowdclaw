import { getProjectBundle } from "../../../../src/server/services/project-service";
import { json } from "../../../../src/server/http";

export async function GET(
  _request: Request,
  { params }: { params: Record<string, string> },
) {
  const bundle = await getProjectBundle(params.id);
  return bundle ? json(bundle) : json({ error: "project not found" }, 404);
}
