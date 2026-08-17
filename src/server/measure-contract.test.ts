import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dir, "../..");

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (full.includes("node_modules")) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(name)) files.push(full);
  }
  return files;
}

describe("measure-fn contract", () => {
  test("nested spans call measure() directly instead of expecting an injected child function", () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => !file.endsWith("measure-contract.test.ts"))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        const bad =
          /measure\([\s\S]{0,300}?async\s*\(m\)\s*=>|\bawait\s+m\s*\(/m.test(
            source,
          );
        return bad ? [file.slice(ROOT.length + 1)] : [];
      });

    expect(offenders).toEqual([]);
  });

  test("important runtime spans use action objects with start/end summaries", () => {
    const files = [
      "project-agent.ts",
      "src/server/agent/jsx-agent.tsx",
      "src/server/services/funding-service.ts",
      "src/server/services/project-service.ts",
      "src/server/services/treasury-service.ts",
      "src/server/wallets/solana-rpc.ts",
      "src/server/wallets/solard.ts",
      "src/server/worker/tick-project.ts",
    ];

    const offenders = files.flatMap((relative) => {
      const source = readFileSync(resolve(ROOT, relative), "utf8");
      return source.includes('measure("') || source.includes("measure(`")
        ? [relative]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
