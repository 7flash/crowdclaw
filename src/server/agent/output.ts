import type { Milestone } from "../../shared/types";

export function toMilestone(
  input: { title: string; goal?: string; costCredits: number },
  createdAt = Date.now(),
): Milestone {
  return {
    title: input.title,
    goal: input.goal || "",
    costCredits: input.costCredits,
    state: "queued",
    createdAt,
  };
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

export function validateArtifactHtml(html: string): string[] {
  const issues: string[] = [];
  if (html.length < 300)
    issues.push("artifact is too small to be a playable game");
  if (html.length > 250_000)
    issues.push("artifact exceeds the 250 KB safety limit");
  if (!/<!doctype\s+html/i.test(html))
    issues.push("artifact is missing <!DOCTYPE html>");
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html))
    issues.push("artifact is not a complete HTML document");
  if (!/<body[\s>]/i.test(html) || !/<\/body>/i.test(html))
    issues.push("artifact is missing a complete body");
  if (!/<script[\s>]/i.test(html) || !/<\/script>/i.test(html))
    issues.push("artifact has no executable game script");
  if (/<script[^>]+\bsrc\s*=/i.test(html))
    issues.push("external script sources are not allowed");
  if (/<link[^>]+\bhref\s*=/i.test(html))
    issues.push("external linked resources are not allowed");
  if (
    /\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\s*\(|EventSource\s*\(|sendBeacon\s*\(|import\s*\()/i.test(
      html,
    )
  )
    issues.push("network requests or dynamic imports are not allowed");
  if (/\b(?:localStorage|sessionStorage|indexedDB)\b/i.test(html))
    issues.push("persistent browser storage is not allowed");
  return issues;
}
