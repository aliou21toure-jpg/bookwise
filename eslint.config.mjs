import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "react/no-danger": "error",
      // Raw SQL strings bypass parameterization; only the `sql` tagged template is allowed.
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='sql'][property.name='raw']",
          message: "sql.raw() skips parameterization. Use the sql`` tagged template.",
        },
      ],
    },
  },
  {
    // UI and route layers talk to modules through their services, never to the database.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/db", "@/db/*"], message: "Call a module service instead of the database." },
            { group: ["**/*.repository", "**/*.repository.ts"], message: "Repositories are private to their module." },
          ],
        },
      ],
    },
  },
  {
    // Client-facing components must never import server code.
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/modules/*", "@/lib/env", "@/lib/redis", "@/jobs/*"], message: "Server-only code." }] },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "next-env.d.ts", "src/db/migrations/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
