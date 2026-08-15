import type { Milestone } from "../shared/types";

export function parsePlanPreview(text: string): {
  name: string;
  summary: string;
  miles: Milestone[];
} {
  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const read = (prefix: string) =>
    rows
      .find((row) => row.startsWith(prefix))
      ?.slice(2)
      .trim() || "";
  const miles = rows
    .filter((row) => row.startsWith("M|"))
    .map((row) => {
      const [t = "", raw = ""] = row.slice(2).split("|");
      return {
        t: t.trim(),
        c: Math.max(1, Math.min(4, Number.parseInt(raw, 10) || 2)),
      };
    })
    .filter((mile) => mile.t);
  return { name: read("N|"), summary: read("S|"), miles };
}
