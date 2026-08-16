import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("embedded worker server lifetime", () => {
  test("does not stop the worker when tradjs serve() returns", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../../server.ts"),
      "utf8",
    );
    const serveAt = source.indexOf("await serve(");
    const startAt = source.indexOf("startAgentWorker()", serveAt);

    expect(serveAt).toBeGreaterThan(-1);
    expect(startAt).toBeGreaterThan(serveAt);
    expect(source).not.toContain("finally {\n  stopWorker()");
    expect(source).not.toContain("finally {\r\n  stopWorker()");
  });
});
