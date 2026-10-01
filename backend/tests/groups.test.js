process.env.NODE_ENV = "test";

jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));

const request = require("supertest");
const pool = require("../db");
const app = require("../server");

function makeClient(queryImpl) {
  return { query: jest.fn(queryImpl), release: jest.fn() };
}

beforeEach(() => {
  pool.query.mockReset();
  pool.connect.mockReset();
});

describe("POST /api/groups", () => {
  it("rejects invalid input before touching the database", async () => {
    const res = await request(app).post("/api/groups").send({ name: "A", members: ["Ama"] });
    expect(res.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("creates a group with its members in one transaction", async () => {
    let memberCounter = 0;
    const client = makeClient((sql, params) => {
      if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT")) return Promise.resolve();
      if (sql.startsWith("INSERT INTO groups")) {
        return Promise.resolve({ rows: [{ id: 1, name: params[0], created_at: "2026-10-01T00:00:00Z" }] });
      }
      if (sql.startsWith("INSERT INTO members")) {
        memberCounter++;
        return Promise.resolve({ rows: [{ id: memberCounter, name: params[1] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    pool.connect.mockResolvedValueOnce(client);

    const res = await request(app).post("/api/groups").send({ name: "Accra Trip", members: ["Ama", "Kwesi"] });

    expect(res.status).toBe(201);
    expect(res.body.group.name).toBe("Accra Trip");
    expect(res.body.group.members).toHaveLength(2);
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("rolls back and 500s if a member insert fails", async () => {
    const client = makeClient((sql) => {
      if (sql.startsWith("BEGIN") || sql.startsWith("ROLLBACK")) return Promise.resolve();
      if (sql.startsWith("INSERT INTO groups")) {
        return Promise.resolve({ rows: [{ id: 1, name: "Trip", created_at: "now" }] });
      }
      if (sql.startsWith("INSERT INTO members")) {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve({ rows: [] });
    });
    pool.connect.mockResolvedValueOnce(client);

    const res = await request(app).post("/api/groups").send({ name: "Trip", members: ["Ama", "Kwesi"] });
    expect(res.status).toBe(500);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("GET /api/groups/:id", () => {
  it("rejects a non-numeric id", async () => {
    const res = await request(app).get("/api/groups/abc");
    expect(res.status).toBe(400);
  });

  it("404s when the group doesn't exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/groups/99");
    expect(res.status).toBe(404);
  });

  it("returns the group and its members", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: "Trip", created_at: "now" }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, name: "Ama" }, { id: 2, name: "Kwesi" }] });
    const res = await request(app).get("/api/groups/1");
    expect(res.status).toBe(200);
    expect(res.body.group.members).toHaveLength(2);
  });
});

describe("POST /api/groups/:id/members", () => {
  it("404s when the group doesn't exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/api/groups/99/members").send({ name: "Efua" });
    expect(res.status).toBe(404);
  });

  it("rejects a duplicate name", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ name: "Ama" }] });
    const res = await request(app).post("/api/groups/1/members").send({ name: "ama" });
    expect(res.status).toBe(400);
  });

  it("adds a new member", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ name: "Ama" }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, name: "Efua" }] });
    const res = await request(app).post("/api/groups/1/members").send({ name: "Efua" });
    expect(res.status).toBe(201);
    expect(res.body.member.name).toBe("Efua");
  });
});

describe("POST /api/groups/:id/expenses", () => {
  it("404s when the group doesn't exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post("/api/groups/99/expenses")
      .send({ description: "Dinner", amount: "30", payer_id: 1 });
    expect(res.status).toBe(404);
  });

  it("rejects a payer not in the group", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
    const res = await request(app)
      .post("/api/groups/1/expenses")
      .send({ description: "Dinner", amount: "30", payer_id: 99 });
    expect(res.status).toBe(400);
  });

  it("creates an expense with an even split across all members by default", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // group exists
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }); // members

    const client = makeClient((sql, params) => {
      if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT")) return Promise.resolve();
      if (sql.startsWith("INSERT INTO expenses")) {
        return Promise.resolve({
          rows: [{ id: 10, description: params[2], amount_cents: params[3], created_at: "now" }],
        });
      }
      if (sql.startsWith("INSERT INTO expense_participants")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    pool.connect.mockResolvedValueOnce(client);

    const res = await request(app)
      .post("/api/groups/1/expenses")
      .send({ description: "Dinner", amount: "10.00", payer_id: 1 });

    expect(res.status).toBe(201);
    expect(res.body.expense.amount_cents).toBe(1000);
    expect(res.body.expense.participants).toHaveLength(3);
    const total = res.body.expense.participants.reduce((sum, p) => sum + p.share_cents, 0);
    expect(total).toBe(1000);
  });
});

describe("GET /api/groups/:id/expenses", () => {
  it("returns an empty list for a group with no expenses", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/groups/1/expenses");
    expect(res.status).toBe(200);
    expect(res.body.expenses).toEqual([]);
  });

  it("attaches resolved participant names to each expense", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 10, description: "Dinner", amount_cents: 1000, created_at: "now", payer_id: 1, payer_name: "Ama" }],
      })
      .mockResolvedValueOnce({
        rows: [
          { expense_id: 10, member_id: 1, share_cents: 500, name: "Ama" },
          { expense_id: 10, member_id: 2, share_cents: 500, name: "Kwesi" },
        ],
      });
    const res = await request(app).get("/api/groups/1/expenses");
    expect(res.status).toBe(200);
    expect(res.body.expenses[0].participants).toHaveLength(2);
  });
});

describe("GET /api/groups/:id/balances", () => {
  it("computes balances and a settlement from raw rows", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: "Ama" }, { id: 2, name: "Kwesi" }] })
      .mockResolvedValueOnce({ rows: [{ payer_id: 1, amount_cents: 1000 }] })
      .mockResolvedValueOnce({ rows: [{ member_id: 1, share_cents: 500 }, { member_id: 2, share_cents: 500 }] });

    const res = await request(app).get("/api/groups/1/balances");
    expect(res.status).toBe(200);
    expect(res.body.settlement).toEqual([{ fromId: 2, fromName: "Kwesi", toId: 1, toName: "Ama", amountCents: 500 }]);
  });

  it("404s when the group has no members and doesn't exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/groups/99/balances");
    expect(res.status).toBe(404);
  });
});
