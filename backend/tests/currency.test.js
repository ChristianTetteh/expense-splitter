const { newUser, resetDb, stateFor } = require("./helpers");
const pool = require("../db");

beforeAll(resetDb);
afterAll(() => pool.end());

describe("tab currency", () => {
  it("defaults to Ghana cedis when none is chosen", async () => {
    const ama = await newUser("Ama");
    const res = await ama.agent.post("/api/groups").send({ name: "Kumasi trip" });
    expect(res.status).toBe(201);
    expect(res.body.group.currency).toBe("GHS");
  });

  it("lets the creator choose US dollars, and shows it in the list and the tab", async () => {
    const ama = await newUser("Ama");
    const res = await ama.agent.post("/api/groups").send({ name: "US trip", currency: "USD" });
    expect(res.status).toBe(201);
    expect(res.body.group.currency).toBe("USD");
    const list = await ama.agent.get("/api/groups");
    expect(list.body.groups.find((g) => g.name === "US trip").currency).toBe("USD");
    expect((await stateFor(ama, res.body.group.id)).group.currency).toBe("USD");
  });

  it("rejects any other currency and stores nothing", async () => {
    const ama = await newUser("Ama");
    for (const currency of ["EUR", "ghs", "", null, 1]) {
      const res = await ama.agent.post("/api/groups").send({ name: "Bad currency", currency });
      expect(res.status).toBe(400);
    }
    const list = await ama.agent.get("/api/groups");
    expect(list.body.groups).toHaveLength(0);
  });

  it("has no way to change a tab's currency afterwards", async () => {
    const ama = await newUser("Ama");
    const tab = (await ama.agent.post("/api/groups").send({ name: "Locked" })).body;
    for (const method of ["put", "patch"]) {
      const res = await ama.agent[method](`/api/groups/${tab.group.id}`).send({ currency: "USD" });
      expect(res.status).toBe(404);
    }
    expect((await stateFor(ama, tab.group.id)).group.currency).toBe("GHS");
  });

  it("the database refuses a currency the app doesn't know", async () => {
    const ama = await newUser("Ama");
    await expect(pool.query("UPDATE groups SET currency = 'EUR'")).rejects.toThrow();
  });
});
