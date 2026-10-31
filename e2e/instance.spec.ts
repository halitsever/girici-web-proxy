import { expect, INSTANCE, test } from "./support/test.ts";

test("the instance server runs with its own seeded admin", async ({ request }) => {
  const state = await (await request.get(`${INSTANCE}/_g/auth/state`)).json();
  expect(state).toMatchObject({ setup: false, public: true, authed: false });
});
