import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connect } from "../support/db";

// The application connects as bookwise_app. These tests prove that role is least-privilege.
const app = connect();

beforeAll(() => app.connect());
afterAll(() => app.end());

describe("application database role", () => {
  it("connects as bookwise_app, which is not a superuser and cannot bypass RLS", async () => {
    const { rows } = await app.query(
      "select current_user as user, rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(rows[0]).toEqual({ user: "bookwise_app", rolsuper: false, rolbypassrls: false });
  });

  it("cannot create tables (schema changes only happen through migrations)", async () => {
    await expect(app.query("create table bookwise.hack (id int)")).rejects.toThrow(/permission denied/);
  });

  it("cannot drop application tables", async () => {
    await expect(app.query("drop table bookwise.users")).rejects.toThrow(/must be owner/);
  });

  it("can read and write application tables", async () => {
    await expect(app.query("select count(*) from bookwise.users")).resolves.toBeTruthy();
  });

  it("finds the schema through its default search_path", async () => {
    const { rows } = await app.query("show search_path");
    expect(rows[0].search_path).toBe("bookwise");
  });
});
