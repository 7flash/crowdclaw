import type { Milestone } from "../../shared/types";

export type ParsedAgentOutput = {
  name: string;
  summary: string;
  notes: string[];
  miles: Milestone[];
  code: string;
};

export function parseAgentOutput(text: string): ParsedAgentOutput {
  const cut = text.indexOf("CODE|");
  const head = cut === -1 ? text : text.slice(0, cut);
  const rows = head
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const one = (prefix: string) => {
    const line = rows.find((row) => row.startsWith(prefix));
    return line ? line.slice(2).trim() : "";
  };
  const notes = rows
    .filter((row) => row.startsWith("T|"))
    .map((row) => row.slice(2));
  const miles = rows
    .filter((row) => row.startsWith("M|"))
    .map((row) => {
      const [title = "", rawCost = ""] = row.slice(2).split("|");
      const c = Math.max(1, Math.min(4, Number.parseInt(rawCost, 10) || 2));
      return { t: title.trim(), c };
    })
    .filter((mile) => mile.t);

  let code = cut === -1 ? "" : text.slice(cut + 5).trim();
  code = code
    .replace(/^```html?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  return { name: one("N|"), summary: one("S|"), notes, miles, code };
}

export function sealHtml(code: string): string {
  if (!code) return "";
  if (/<\/html>/i.test(code)) return code;
  let sealed = code;
  const count = (re: RegExp) => (sealed.match(re) || []).length;
  if (count(/<script/gi) > count(/<\/script>/gi)) sealed += "\n</script>";
  if (count(/<body/gi) > count(/<\/body>/gi)) sealed += "\n</body>";
  sealed += "\n</html>";
  return sealed;
}
