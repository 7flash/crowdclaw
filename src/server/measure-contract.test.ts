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
  test("nested spans call measure() directly instead of expecting a callback child function", () => {
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
});
