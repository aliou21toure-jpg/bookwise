import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/account", "/account"],
    ["/account?tab=orgs#top", "/account?tab=orgs#top"],
  ])("keeps the same-origin path %s", (input, out) => {
    expect(safeNextPath(input)).toBe(out);
  });

  it.each([null, "", "https://evil.example", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "account"])(
    "falls back for %j",
    (input) => {
      expect(safeNextPath(input)).toBe("/account");
    },
  );
});
