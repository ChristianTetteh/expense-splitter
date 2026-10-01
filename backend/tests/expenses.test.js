process.env.NODE_ENV = "test";

jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));

const request = require("supertest");
const pool = require("../db");
const app = require("../server");

beforeEach(() => {
  pool.query.mockReset();
});

describe("DELETE /api/expenses/:id", () => {
  it("rejects a non-numeric id", async () => {
    const res = await request(app).delete("/api/expenses/abc");
    expect(res.status).toBe(400);
  });

  it("404s when the expense doesn't exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete("/api/expenses/99");
    expect(res.status).toBe(404);
  });

  it("deletes an existing expense", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = await request(app).delete("/api/expenses/1");
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});
