import type { Metadata } from "next";
import Link from "next/link";

import spec from "@/generated/openapi.json";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "API reference",
  description: "The BookWise REST API: endpoints, authentication, request schemas and error codes.",
};

interface Operation {
  tags: string[];
  summary: string;
  description?: string;
  operationId: string;
  security: unknown[];
  parameters: { name: string; in: string; required: boolean; schema: { type?: string; format?: string; enum?: unknown[] } }[];
  requestBody?: { content: { "application/json": { schema: unknown } } };
  responses: Record<string, unknown>;
}

const METHOD_TONE: Record<string, string> = {
  get: "bg-accent text-accent-foreground",
  post: "bg-success/15 text-foreground",
  put: "bg-success/15 text-foreground",
  patch: "bg-muted text-foreground",
  delete: "bg-destructive/10 text-foreground ring-1 ring-destructive/40 ring-inset",
};

const ops = Object.entries(spec.paths as Record<string, Record<string, Operation>>).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({ path, method, op })),
);
const tags = (spec.tags as { name: string }[]).map((t) => t.name).filter((t) => ops.some((o) => o.op.tags[0] === t));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function typeLabel(schema: Operation["parameters"][number]["schema"]): string {
  if (schema.enum) return schema.enum.map(String).join(" | ");
  return [schema.type, schema.format].filter(Boolean).join(", ") || "any";
}

/** Static page: the reference is generated at build time from src/generated/openapi.json. */
export default function ApiReferencePage() {
  return (
    <main className="mx-auto grid w-full max-w-5xl flex-1 gap-8 px-4 py-8 sm:px-6">
      <div className="grid gap-3">
        <Link href="/" className="text-sm font-semibold tracking-wide text-primary uppercase">
          BookWise
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">API reference</h1>
        <p className="max-w-prose text-muted-foreground">{spec.info.description}</p>
        <ul className="grid gap-1 text-sm text-muted-foreground">
          <li>
            Authentication: sign in with <code className="font-mono text-foreground">POST /api/v1/auth/login</code>; the session cookie is sent with every
            request. Writes must come from the same origin.
          </li>
          <li>
            Errors: <code className="font-mono text-foreground">{`{ "error": { "code", "message", "requestId" } }`}</code>, with stable codes such as{" "}
            <code className="font-mono text-foreground">SLOT_UNAVAILABLE</code> or <code className="font-mono text-foreground">RATE_LIMITED</code>.
          </li>
          <li>
            Machine-readable:{" "}
            <a href="/api/v1/openapi.json" className="text-primary underline underline-offset-4">
              /api/v1/openapi.json
            </a>{" "}
            (OpenAPI {spec.openapi}, {ops.length} operations, version {spec.info.version}).
          </li>
        </ul>
      </div>

      <nav aria-label="API sections" className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <a key={t} href={`#${slug(t)}`} className="rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-muted">
            {t}
          </a>
        ))}
      </nav>

      {tags.map((tag) => (
        <section key={tag} id={slug(tag)} aria-labelledby={`${slug(tag)}-heading`} className="grid scroll-mt-6 gap-3">
          <h2 id={`${slug(tag)}-heading`} className="text-xl font-semibold">
            {tag}
          </h2>
          <ul className="grid gap-3">
            {ops
              .filter((o) => o.op.tags[0] === tag)
              .map(({ path, method, op }) => (
                <li key={op.operationId} id={op.operationId} className="grid gap-2 rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded px-2 py-0.5 font-mono text-xs font-semibold uppercase", METHOD_TONE[method])}>{method}</span>
                    <code className="font-mono text-sm break-all">{path}</code>
                    {op.security.length === 0 && <span className="text-xs text-muted-foreground">public</span>}
                  </div>
                  <p className="text-sm">{op.summary}</p>
                  {op.description && <p className="text-sm text-muted-foreground">{op.description}</p>}
                  {op.parameters.length > 0 && (
                    <div role="region" aria-label={`Parameters of ${method.toUpperCase()} ${path}`} tabIndex={0} className="overflow-x-auto">
                      <table className="w-full min-w-[28rem] text-left text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th scope="col" className="py-1 pr-3 font-medium">
                              Parameter
                            </th>
                            <th scope="col" className="py-1 pr-3 font-medium">
                              In
                            </th>
                            <th scope="col" className="py-1 font-medium">
                              Type
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {op.parameters.map((p) => (
                            <tr key={`${p.in}-${p.name}`} className="border-t">
                              <td className="py-1 pr-3 font-mono">
                                {p.name}
                                {p.required ? " *" : ""}
                              </td>
                              <td className="py-1 pr-3">{p.in}</td>
                              <td className="py-1 break-all">{typeLabel(p.schema)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {op.requestBody && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Request body (JSON Schema)</summary>
                      <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3">{JSON.stringify(op.requestBody.content["application/json"].schema, null, 2)}</pre>
                    </details>
                  )}
                  <p className="text-xs text-muted-foreground">Responses: {Object.keys(op.responses).join(", ")}</p>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
