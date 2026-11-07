/**
 * Writes src/generated/openapi.json from the API route files.
 *
 *   npx tsx --conditions=react-server scripts/openapi.ts
 *
 * tests/integration/openapi.test.ts regenerates it in memory and fails if the committed copy is out of date.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildOpenApi, type RouteFile } from "@/lib/openapi/build";

const ROOT = path.resolve("src/app/api/v1");

async function routeFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await routeFiles(full)));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

async function main(): Promise<void> {
  const routes: RouteFile[] = [];
  for (const file of await routeFiles(ROOT)) {
    routes.push({
      path: path.relative(ROOT, path.dirname(file)).split(path.sep).join("/").replace(/^/, "/").replace(/^\/$/, ""),
      source: await readFile(file, "utf8"),
      module: (await import(file)) as Record<string, unknown>,
    });
  }
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  const doc = buildOpenApi(routes, pkg.version);
  await writeFile("src/generated/openapi.json", `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote src/generated/openapi.json (${Object.keys(doc.paths as object).length} paths)`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
