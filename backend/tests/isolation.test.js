// "Who can see what": a tab is visible only to its current members, and the
// API answers outsiders exactly as if the tab didn't exist.
const { pool, resetDb, newUser, createTab, joinTab, stateFor, memberIdOf } = require("./helpers");

let ama, kwesi, stranger, tab;

beforeAll(async () => {
  await resetDb();
  ama = await newUser("Ama");
  kwesi = await newUser("Kwesi");
  stranger = await newUser("Stranger");
  tab = await createTab(ama, "Ama & Kwesi's flat");
  tab = await joinTab(ama, kwesi, tab);
  await ama.agent
    .post(`/api/groups/${tab.group.id}/expenses`)
    .send({ description: "Rent", amount: "800", participant_ids: tab.members.map((m) => m.id) });
});
afterAll(() => pool.end());

describe("tab ids", () => {
  it("are random UUIDs, not counters", () => {
    expect(tab.group.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("an outsider", () => {
  it("can't see the tab, and gets the same 404 as for a tab that doesn't exist", async () => {
    const real = await stranger.agent.get(`/api/groups/${tab.group.id}`);
    const fake = await stranger.agent.get("/api/groups/3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b");
    const junk = await stranger.agent.get("/api/groups/1");
    expect(real.status).toBe(404);
    expect(real.body).toEqual(fake.body);
    expect(junk.body).toEqual(fake.body);
  });

  it("doesn't get the tab in their own list", async () => {
    const res = await stranger.agent.get("/api/groups");
    expect(res.body.groups).toEqual([]);
  });

  it("can't write anything to it — every route answers 404", async () => {
    const id = tab.group.id;
    const expenseId = (await stateFor(ama, id)).expenses[0].id;
    const attempts = [
      stranger.agent.post(`/api/groups/${id}/expenses`).send({ description: "x", amount: "1", participant_ids: [memberIdOf(tab, "Ama")] }),
      stranger.agent.post(`/api/groups/${id}/expenses/${expenseId}/void`).send({}),
      stranger.agent.post(`/api/groups/${id}/payments`).send({ direction: "received", counterparty_id: memberIdOf(tab, "Ama"), amount: "800" }),
      stranger.agent.post(`/api/groups/${id}/leave`).send({}),
      stranger.agent.post(`/api/groups/${id}/invite/regenerate`).send({}),
      stranger.agent.post(`/api/groups/${id}/requests/${stranger.user.id}/approve`).send({}),
      stranger.agent.post(`/api/groups/${id}/members/${memberIdOf(tab, "Kwesi")}/remove`).send({}),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    // …and nothing changed.
    const after = await stateFor(ama, id);
    expect(after.expenses).toHaveLength(1);
    expect(after.expenses[0].voided_at).toBeNull();
    expect(after.payments).toHaveLength(0);
  });

  it("can't use an expense id from one tab through another tab they DO belong to", async () => {
    const theirTab = await createTab(stranger, "Stranger's own tab");
    const expenseId = (await stateFor(ama, tab.group.id)).expenses[0].id;
    const res = await stranger.agent.post(`/api/groups/${theirTab.group.id}/expenses/${expenseId}/void`).send({});
    expect(res.status).toBe(404);
    expect((await stateFor(ama, tab.group.id)).expenses[0].voided_at).toBeNull();
  });

  it("can't split an expense with people from someone else's tab", async () => {
    const theirTab = await createTab(stranger, "Another tab");
    const res = await stranger.agent
      .post(`/api/groups/${theirTab.group.id}/expenses`)
      .send({ description: "Sneaky", amount: "100", participant_ids: [memberIdOf(tab, "Kwesi")] });
    expect(res.status).toBe(400);
  });
});

describe("the database itself", () => {
  it("refuses a share that points a member of one tab at another tab's expense", async () => {
    const other = await createTab(stranger, "DB-level check");
    const expense = (await pool.query("SELECT id FROM expenses WHERE group_id = $1", [tab.group.id])).rows[0];
    const strangerMember = other.me.member_id;
    await expect(
      pool.query("INSERT INTO expense_shares (expense_id, group_id, member_id, share_cents, status) VALUES ($1, $2, $3, 1, 'accepted')", [
        expense.id,
        tab.group.id,
        strangerMember,
      ])
    ).rejects.toThrow(/foreign key/);
  });
});

describe("invite links", () => {
  it("are shown only to the owner", async () => {
    expect(tab.group.invite_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const kwesiView = await stateFor(kwesi, tab.group.id);
    expect(kwesiView.group.invite_token).toBeUndefined();
    expect(kwesiView.join_requests).toEqual([]);
  });

  it("let someone ASK to join, but give no access until the owner approves", async () => {
    const owner = await newUser("Owner");
    const asker = await newUser("Asker");
    const t = await createTab(owner, "Approval check");

    const preview = await asker.agent.get(`/api/invites/${t.group.invite_token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.invite).toEqual({ group_name: "Approval check", owner_name: "Owner", member_count: 1, status: "none" });
    expect(JSON.stringify(preview.body)).not.toContain(t.group.id); // the tab id isn't revealed

    await asker.agent.post(`/api/invites/${t.group.invite_token}/request`).send({});
    expect((await asker.agent.get(`/api/groups/${t.group.id}`)).status).toBe(404);

    // The asker can't approve themselves.
    const selfApprove = await asker.agent.post(`/api/groups/${t.group.id}/requests/${asker.user.id}/approve`).send({});
    expect(selfApprove.status).toBe(404);

    const declined = await owner.agent.post(`/api/groups/${t.group.id}/requests/${asker.user.id}/decline`).send({});
    expect(declined.status).toBe(200);
    expect((await asker.agent.get(`/api/groups/${t.group.id}`)).status).toBe(404);
  });

  it("can't be managed or approved by a non-owner member", async () => {
    const asker = await newUser("Another asker");
    await asker.agent.post(`/api/invites/${tab.group.invite_token}/request`).send({});
    expect((await kwesi.agent.post(`/api/groups/${tab.group.id}/requests/${asker.user.id}/approve`).send({})).status).toBe(403);
    expect((await kwesi.agent.post(`/api/groups/${tab.group.id}/invite/regenerate`).send({})).status).toBe(403);
    expect((await asker.agent.get(`/api/groups/${tab.group.id}`)).status).toBe(404);
  });

  it("stop working once regenerated or switched off", async () => {
    const owner = await newUser("Rotator");
    const t = await createTab(owner, "Rotation");
    const oldToken = t.group.invite_token;
    const regenerated = await owner.agent.post(`/api/groups/${t.group.id}/invite/regenerate`).send({});
    const newToken = regenerated.body.group.invite_token;
    expect(newToken).not.toEqual(oldToken);

    const outsider = await newUser("Late");
    expect((await outsider.agent.get(`/api/invites/${oldToken}`)).status).toBe(404);
    expect((await outsider.agent.get(`/api/invites/${newToken}`)).status).toBe(200);

    await owner.agent.post(`/api/groups/${t.group.id}/invite/disable`).send({});
    expect((await outsider.agent.get(`/api/invites/${newToken}`)).status).toBe(404);
    expect((await outsider.agent.post(`/api/invites/${newToken}/request`).send({})).status).toBe(404);
  });
});

describe("names", () => {
  it("two people with the same display name are labelled apart", async () => {
    const owner = await newUser("Kojo");
    const twin = await newUser("Kojo");
    let t = await createTab(owner, "Two Kojos");
    t = await joinTab(owner, twin, t);
    expect(t.members.map((m) => m.name)).toEqual(["Kojo", "Kojo (2)"]);
  });

  it("injection-shaped text is stored and returned literally", async () => {
    const res = await ama.agent
      .post(`/api/groups/${tab.group.id}/expenses`)
      .send({ description: "'); DROP TABLE users; -- <script>alert(1)</script>", amount: "1", participant_ids: [memberIdOf(tab, "Ama")] });
    expect(res.status).toBe(201);
    expect(res.body.expenses[0].description).toBe("'); DROP TABLE users; -- <script>alert(1)</script>");
    expect((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBeGreaterThan(0);
  });
});
