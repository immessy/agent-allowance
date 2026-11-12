import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const regex = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?from\s+)?["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    if (match[1]) {
      specs.push(match[1]);
    }
  }
  return specs;
}

describe("Architecture boundary guards (T3.3, TDD 8.6)", () => {
  const srcRoot = path.resolve(import.meta.dirname, "../../src");
  const allFiles = collectSourceFiles(srcRoot);

  it("allows ONLY src/infra/paypal/executor.ts to import the PayPal client", () => {
    const executorPath = path.normalize(
      path.join(srcRoot, "infra", "paypal", "executor.ts")
    );
    const clientPath = path.normalize(
      path.join(srcRoot, "infra", "paypal", "client.ts")
    );

    const violations: string[] = [];

    for (const file of allFiles) {
      const normalizedFile = path.normalize(file);
      if (normalizedFile === executorPath || normalizedFile === clientPath) {
        continue;
      }
      const content = readFileSync(file, "utf8");
      const specs = extractImportSpecifiers(content);
      for (const spec of specs) {
        const resolved = spec.startsWith("@/")
          ? path.normalize(path.join(srcRoot, `${spec.slice(2)}.ts`))
          : spec.startsWith(".")
            ? path.normalize(path.resolve(path.dirname(file), `${spec}.ts`))
            : "";

        if (
          spec.includes("paypal/client") ||
          resolved === clientPath
        ) {
          violations.push(`${path.relative(srcRoot, file)} -> ${spec}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps src/domain pure with zero imports from infra, services, or app", () => {
    const domainDir = path.normalize(path.join(srcRoot, "domain"));
    const domainFiles = allFiles.filter((f) =>
      path.normalize(f).startsWith(domainDir + path.sep)
    );

    const violations: string[] = [];
    for (const file of domainFiles) {
      const content = readFileSync(file, "utf8");
      const specs = extractImportSpecifiers(content);
      for (const spec of specs) {
        if (
          spec.startsWith("@/infra") ||
          spec.startsWith("@/services") ||
          spec.startsWith("@/app") ||
          spec.startsWith("node:") ||
          /^\.\.\/(infra|services|app)/.test(spec)
        ) {
          violations.push(`${path.relative(srcRoot, file)} -> ${spec}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
