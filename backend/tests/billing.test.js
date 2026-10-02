// "Nobody can get out of paying": the rules around who can record, void,
// confirm and leave — and that they hold even under concurrent requests.
const { pool, resetDb, newUser, createTab, joinTab, stateFor, memberIdOf, netOf } = require("./helpers");

beforeAll(resetDb);
afterAll(() => pool.end());

// Ama, Kwesi and Esi share a tab; Ama pays for a $30 dinner for all three,
// and Kwesi and Esi both accept their $10 shares.
async function dinnerTab() {
  const ama = await newUser("Ama");
  const kwesi = await newUser("Kwesi");
  const esi = await newUser("Esi");
  let tab = await createTab(ama, "Dinner club");
  tab = await joinTab(ama, kwesi, tab);
  tab = await joinTab(ama, esi, tab);
  const res = await ama.agent
    .post(`/api/groups/${tab.group.id}/expenses`)
    .send({ description: "Dinner", amount: "30", participant_ids: tab.members.map((m) => m.id) });
  expect(res.status).toBe(201);
  const id = tab.group.id;
  const ids = { ama: memberIdOf(tab, "Ama"), kwesi: memberIdOf(tab, "Kwesi"), esi: memberIdOf(tab, "Esi") };
  const expenseId = res.body.expenses[0].id;
  for (const who of [kwesi, esi]) {
    expect((await who.agent.post(`/api/groups/${id}/expenses/${expenseId}/accept`).send({})).status).toBe(200);
  }
  return { ama, kwesi, esi, id, ids, expenseId };
}

describe("recording expenses", () => {
  it("the payer is always the person recording it — a payer_id in the request is ignored", async () => {
    const { kwesi, id, ids } = await dinnerTab();
    // Kwesi tries to record that ESI paid $500 for him.
    const res = await kwesi.agent
      .post(`/api/groups/${id}/expenses`)
      .send({ description: "Fake", amount: "500", payer_id: ids.esi, payer_member_id: ids.esi, participant_ids: [ids.kwesi] });
    expect(res.status).toBe(201);
    expect(res.body.expenses[0].payer_name).toBe("Kwesi");
    // Kwesi "paid" for himself only, so nobody's balance moved.
    expect(netOf(res.body, "Esi")).toBe(-1000);
  });

  it("everyone's share is exact to the cent and the tab always nets to zero", async () => {
    const { ama, id, ids } = await dinnerTab();
    const res = await ama.agent
      .post(`/api/groups/${id}/expenses`)
      .send({ description: "Snacks", amount: "10", participant_ids: [ids.ama, ids.kwesi, ids.esi] });
    const snacks = res.body.expenses[0];
    expect(snacks.shares.map((s) => s.share_cents)).toEqual([334, 333, 333]);
    expect(res.body.balances.reduce((sum, b) => sum + b.netCents, 0)).toBe(0);
  });

  it("amounts must be sent as text, so nothing is silently rounded", async () => {
    const { ama, id, ids } = await dinnerTab();
    const res = await ama.agent.post(`/api/groups/${id}/expenses`).send({ description: "x", amount: 12.345, participant_ids: [ids.ama] });
    expect(res.status).toBe(400);
  });
});

describe("charging other people needs their OK", () => {
  it("a charge to someone else counts only once they accept it", async () => {
    const { ama, kwesi, id, ids } = await dinnerTab();
    const res = await ama.agent.post(`/api/groups/${id}/expenses`).send({ description: "Taxi", amount: "8", participant_ids: [ids.ama, ids.kwesi] });
    const taxi = res.body.expenses[0];
    expect(taxi.shares.find((s) => s.member_id === ids.ama).status).toBe("accepted");
    expect(taxi.shares.find((s) => s.member_id === ids.kwesi).status).toBe("pending");
    expect(netOf(res.body, "Kwesi")).toBe(-1000); // unchanged so far

    // Only Kwesi can answer for Kwesi's share.
    expect((await ama.agent.post(`/api/groups/${id}/expenses/${taxi.id}/accept`).send({})).status).toBe(409); // Ama's own share is already accepted
    const accepted = await kwesi.agent.post(`/api/groups/${id}/expenses/${taxi.id}/accept`).send({});
    expect(netOf(accepted.body, "Kwesi")).toBe(-1400);
    expect((await kwesi.agent.post(`/api/groups/${id}/expenses/${taxi.id}/decline`).send({})).status).toBe(409); // can't change your mind later
  });

  it("someone not on the expense can't answer for it", async () => {
    const { ama, esi, id, ids } = await dinnerTab();
    const res = await ama.agent.post(`/api/groups/${id}/expenses`).send({ description: "Taxi", amount: "8", participant_ids: [ids.ama, ids.kwesi] });
    expect((await esi.agent.post(`/api/groups/${id}/expenses/${res.body.expenses[0].id}/accept`).send({})).status).toBe(404);
  });

  it("REGRESSION: a debtor can't cancel their debt with a fake expense charged to the creditor", async () => {
    const { ama, kwesi, id, ids } = await dinnerTab();
    // Kwesi owes Ama $10. He "pays" a fake $10 expense split only with Ama…
    const fake = await kwesi.agent.post(`/api/groups/${id}/expenses`).send({ description: "Totally real", amount: "10", participant_ids: [ids.ama] });
    expect(fake.status).toBe(201);
    expect(netOf(fake.body, "Kwesi")).toBe(-1000); // …which changes nothing until Ama agrees
    // …and he can't leave while it's waiting on her.
    expect((await kwesi.agent.post(`/api/groups/${id}/leave`).send({})).status).toBe(409);
    // Ama declines it: the debt stands, and the refusal is on the record.
    const declined = await ama.agent.post(`/api/groups/${id}/expenses/${fake.body.expenses[0].id}/decline`).send({});
    expect(netOf(declined.body, "Kwesi")).toBe(-1000);
    expect(declined.body.expenses[0].shares.find((s) => s.member_id === ids.ama).status).toBe("declined");
    expect((await kwesi.agent.post(`/api/groups/${id}/leave`).send({})).status).toBe(409);
  });

  it("REGRESSION: a debtor can't push their debt onto someone else", async () => {
    const { ama, esi, id, ids } = await dinnerTab();
    const yaw = await (require("./helpers").newUser)("Yaw");
    const t = await (require("./helpers").joinTab)(ama, yaw, await stateFor(ama, id));
    const yawId = memberIdOf(t, "Yaw");
    const shift = await esi.agent.post(`/api/groups/${id}/expenses`).send({ description: "Shift", amount: "10", participant_ids: [yawId] });
    expect(netOf(shift.body, "Esi")).toBe(-1000);
    expect(netOf(shift.body, "Yaw")).toBe(0);
  });

  it("REGRESSION: declining a real bill doesn't let you walk away — it's an open dispute that blocks leaving", async () => {
    const { ama, kwesi, id, ids } = await dinnerTab();
    await ama.agent.post(`/api/groups/${id}/payments`).send({ direction: "received", counterparty_id: ids.kwesi, amount: "10" });
    const taxi = await ama.agent.post(`/api/groups/${id}/expenses`).send({ description: "Taxi", amount: "20", participant_ids: [ids.ama, ids.kwesi] });
    const eid = taxi.body.expenses[0].id;
    await kwesi.agent.post(`/api/groups/${id}/expenses/${eid}/decline`).send({});
    // Kwesi is at $0 on paper, but can't leave while the dispute is open…
    expect((await kwesi.agent.post(`/api/groups/${id}/leave`).send({})).status).toBe(409);
    // …and the owner can't remove him to make it go away either.
    expect((await ama.agent.post(`/api/groups/${id}/members/${ids.kwesi}/remove`).send({})).status).toBe(409);
    // He can give way and accept after all — then he owes it.
    const accepted = await kwesi.agent.post(`/api/groups/${id}/expenses/${eid}/accept`).send({});
    expect(accepted.status).toBe(200);
    expect(netOf(accepted.body, "Kwesi")).toBe(-1000);
  });

  it("the payer can close a dispute by withdrawing the charge — nobody else can", async () => {
    const { ama, kwesi, esi, id, ids } = await dinnerTab();
    await ama.agent.post(`/api/groups/${id}/payments`).send({ direction: "received", counterparty_id: ids.kwesi, amount: "10" });
    const spam = await ama.agent.post(`/api/groups/${id}/expenses`).send({ description: "Spam", amount: "5", participant_ids: [ids.kwesi] });
    const eid = spam.body.expenses[0].id;
    await kwesi.agent.post(`/api/groups/${id}/expenses/${eid}/decline`).send({});
    expect((await kwesi.agent.post(`/api/groups/${id}/expenses/${eid}/shares/${ids.kwesi}/withdraw`).send({})).status).toBe(403);
    expect((await esi.agent.post(`/api/groups/${id}/expenses/${eid}/shares/${ids.kwesi}/withdraw`).send({})).status).toBe(403);
    const withdrawn = await ama.agent.post(`/api/groups/${id}/expenses/${eid}/shares/${ids.kwesi}/withdraw`).send({});
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.expenses[0].shares[0].status).toBe("withdrawn");
    // A withdrawn charge can't be resurrected by accepting it.
    expect((await kwesi.agent.post(`/api/groups/${id}/expenses/${eid}/accept`).send({})).status).toBe(409);
    expect((await kwesi.agent.post(`/api/groups/${id}/leave`).send({})).status).toBe(200);
  });

  it("an accepted charge can't be withdrawn or declined afterwards", async () => {
    const { ama, kwesi, id, ids, expenseId } = await dinnerTab();
    expect((await ama.agent.post(`/api/groups/${id}/expenses/${expenseId}/shares/${ids.kwesi}/withdraw`).send({})).status).toBe(409);
    expect((await kwesi.agent.post(`/api/groups/${id}/expenses/${expenseId}/decline`).send({})).status).toBe(409);
  });
});

describe("voiding expenses", () => {
  it("someone who owes on it can't void it", async () => {
    const { kwesi, id, expenseId } = await dinnerTab();
    const res = await kwesi.agent.post(`/api/groups/${id}/expenses/${expenseId}/void`).send({});
    expect(res.status).toBe(403);
    const state = await stateFor(kwesi, id);
    expect(state.expenses[0].voided_at).toBeNull();
    expect(netOf(state, "Kwesi")).toBe(-1000);
  });

  it("the payer can void it; it stays in the history, marked with who and when", async () => {
    const { ama, id, expenseId } = await dinnerTab();
    const res = await ama.agent.post(`/api/groups/${id}/expenses/${expenseId}/void`).send({});
    expect(res.status).toBe(200);
    const voided = res.body.expenses.find((e) => e.id === expenseId);
    expect(voided.voided_at).not.toBeNull();
    expect(voided.voided_by_name).toBe("Ama");
    expect(res.body.balances.every((b) => b.netCents === 0)).toBe(true);
    // Can't be voided twice, and there's no way to delete it outright.
    expect((await ama.agent.post(`/api/groups/${id}/expenses/${expenseId}/void`).send({})).status).toBe(409);
    expect((await ama.agent.delete(`/api/groups/${id}/expenses/${expenseId}`).set("Content-Type", "application/json").send({})).status).toBe(404);
  });
});

describe("repayments", () => {
  it("a debtor saying 'I paid' changes nothing until the receiver confirms", async () => {
    const { ama, kwesi, id, ids } = await dinnerTab();
    const claim = await kwesi.agent
      .post(`/api/groups/${id}/payments`)
      .send({ direction: "sent", counterparty_id: ids.ama, amount: "10" });
    expect(claim.status).toBe(201);
    const payment = claim.body.payments[0];
    expect(payment.status).toBe("pending");
    expect(netOf(claim.body, "Kwesi")).toBe(-1000); // still owes

    // Kwesi can't confirm his own claim.
    expect((await kwesi.agent.post(`/api/groups/${id}/payments/${payment.id}/confirm`).send({})).status).toBe(403);

    const confirmed = await ama.agent.post(`/api/groups/${id}/payments/${payment.id}/confirm`).send({});
    expect(confirmed.status).toBe(200);
    expect(netOf(confirmed.body, "Kwesi")).toBe(0);
    expect(netOf(confirmed.body, "Ama")).toBe(1000);
  });

  it("a debtor can't record a payment as 'received' from the creditor to flip the debt", async () => {
    const { kwesi, id, ids } = await dinnerTab();
    // "Ama paid me $10" — recorded by Kwesi. That's Kwesi RECEIVING money,
    // which only increases what he owes; it can never reduce his debt.
    const res = await kwesi.agent
      .post(`/api/groups/${id}/payments`)
      .send({ direction: "received", counterparty_id: ids.ama, amount: "10" });
    expect(res.status).toBe(201);
    expect(netOf(res.body, "Kwesi")).toBe(-2000);
  });

  it("the receiver recording 'they paid me' counts straight away", async () => {
    const { ama, id, ids } = await dinnerTab();
    const res = await ama.agent
      .post(`/api/groups/${id}/payments`)
      .send({ direction: "received", counterparty_id: ids.esi, amount: "10" });
    expect(res.body.payments[0].status).toBe("confirmed");
    expect(netOf(res.body, "Esi")).toBe(0);
  });

  it("REGRESSION: after the grace period the receiver can't undo a confirmed payment to re-bill the payer", async () => {
    const { ama, kwesi, id, ids } = await dinnerTab();
    const claim = await kwesi.agent.post(`/api/groups/${id}/payments`).send({ direction: "sent", counterparty_id: ids.ama, amount: "10" });
    const pid = claim.body.payments[0].id;
    await ama.agent.post(`/api/groups/${id}/payments/${pid}/confirm`).send({});
    await pool.query("UPDATE payments SET resolved_at = now() - interval '16 minutes' WHERE id = $1", [pid]);
    const undo = await ama.agent.post(`/api/groups/${id}/payments/${pid}/void`).send({});
    expect(undo.status).toBe(403);
    expect(netOf(await stateFor(kwesi, id), "Kwesi")).toBe(0);
    // The payer can still undo their own payment (it only hurts them).
    expect((await kwesi.agent.post(`/api/groups/${id}/payments/${pid}/void`).send({})).status).toBe(200);
  });

  it("within the grace period the receiver can fix a typo", async () => {
    const { ama, id, ids } = await dinnerTab();
    const typo = await ama.agent.post(`/api/groups/${id}/payments`).send({ direction: "received", counterparty_id: ids.esi, amount: "100" });
    const pid = typo.body.payments[0].id;
    const undone = await ama.agent.post(`/api/groups/${id}/payments/${pid}/void`).send({});
    expect(undone.status).toBe(200);
    expect(netOf(undone.body, "Esi")).toBe(-1000);
  });

  it("a third member can't confirm, decline, cancel or void someone else's payment", async () => {
    const { ama, kwesi, esi, id, ids } = await dinnerTab();
    const claim = await kwesi.agent.post(`/api/groups/${id}/payments`).send({ direction: "sent", counterparty_id: ids.ama, amount: "10" });
    const pid = claim.body.payments[0].id;
    for (const action of ["confirm", "decline", "cancel"]) {
      expect((await esi.agent.post(`/api/groups/${id}/payments/${pid}/${action}`).send({})).status).toBe(403);
    }
    await ama.agent.post(`/api/groups/${id}/payments/${pid}/confirm`).send({});
    expect((await esi.agent.post(`/api/groups/${id}/payments/${pid}/void`).send({})).status).toBe(403);
  });

  it("declined payments never count and can't be confirmed later", async () => {
    const { ama, kwesi, id, ids } = await dinnerTab();
    const claim = await kwesi.agent.post(`/api/groups/${id}/payments`).send({ direction: "sent", counterparty_id: ids.ama, amount: "10" });
    const pid = claim.body.payments[0].id;
    const declined = await ama.agent.post(`/api/groups/${id}/payments/${pid}/decline`).send({});
    expect(declined.body.payments[0].status).toBe("declined");
    expect(netOf(declined.body, "Kwesi")).toBe(-1000);
    expect((await ama.agent.post(`/api/groups/${id}/payments/${pid}/confirm`).send({})).status).toBe(409);
  });

  it("only the recorder can withdraw a pending claim", async () => {
    const { ama, kwesi, id, ids } = await dinnerTab();
    const claim = await kwesi.agent.post(`/api/groups/${id}/payments`).send({ direction: "sent", counterparty_id: ids.ama, amount: "10" });
    const pid = claim.body.payments[0].id;
    expect((await ama.agent.post(`/api/groups/${id}/payments/${pid}/cancel`).send({})).status).toBe(403);
    expect((await kwesi.agent.post(`/api/groups/${id}/payments/${pid}/cancel`).send({})).status).toBe(200);
  });

  it("unknown actions and tampered ids are rejected", async () => {
    const { ama, id } = await dinnerTab();
    expect((await ama.agent.post(`/api/groups/${id}/payments/1/__proto__`).send({})).status).toBe(404);
    expect((await ama.agent.post(`/api/groups/${id}/payments/abc/confirm`).send({})).status).toBe(404);
    expect((await ama.agent.post(`/api/groups/${id}/payments/99999/confirm`).send({})).status).toBe(404);
  });
});

describe("leaving a tab", () => {
  it("you can't leave while you owe money", async () => {
    const { kwesi, id } = await dinnerTab();
    const res = await kwesi.agent.post(`/api/groups/${id}/leave`).send({});
    expect(res.status).toBe(409);
    expect((await kwesi.agent.get(`/api/groups/${id}`)).status).toBe(200);
  });

  it("you can't leave while a payment involving you is still pending", async () => {
    const { ama, kwesi, id, ids } = await dinnerTab();
    await ama.agent.post(`/api/groups/${id}/payments`).send({ direction: "received", counterparty_id: ids.kwesi, amount: "10" });
    await kwesi.agent.post(`/api/groups/${id}/payments`).send({ direction: "sent", counterparty_id: ids.ama, amount: "5" });
    expect((await kwesi.agent.post(`/api/groups/${id}/leave`).send({})).status).toBe(409);
  });

  it("once square you can leave — then you lose access and can't be billed again", async () => {
    const { ama, kwesi, id, ids, expenseId } = await dinnerTab();
    await ama.agent.post(`/api/groups/${id}/payments`).send({ direction: "received", counterparty_id: ids.kwesi, amount: "10" });
    expect((await kwesi.agent.post(`/api/groups/${id}/leave`).send({})).status).toBe(200);
    expect((await kwesi.agent.get(`/api/groups/${id}`)).status).toBe(404);

    // Nobody can put a new expense on someone who has left…
    const bill = await ama.agent.post(`/api/groups/${id}/expenses`).send({ description: "After", amount: "9", participant_ids: [ids.kwesi] });
    expect(bill.status).toBe(400);
    // …or void an old one they were part of (which would re-open their balance).
    expect((await ama.agent.post(`/api/groups/${id}/expenses/${expenseId}/void`).send({})).status).toBe(409);
  });

  it("the owner can't remove someone who still owes, and can't leave their own tab", async () => {
    const { ama, id, ids } = await dinnerTab();
    expect((await ama.agent.post(`/api/groups/${id}/members/${ids.kwesi}/remove`).send({})).status).toBe(409);
    expect((await ama.agent.post(`/api/groups/${id}/leave`).send({})).status).toBe(400);
  });

  it("holds up under races: leaving and being billed at the same moment never strands a debt", async () => {
    for (let i = 0; i < 8; i++) {
      const { ama, kwesi, id, ids } = await dinnerTab();
      await ama.agent.post(`/api/groups/${id}/payments`).send({ direction: "received", counterparty_id: ids.kwesi, amount: "10" });
      // Kwesi is square. Fire "leave" and a new bill for him simultaneously.
      const [leave, bill] = await Promise.all([
        kwesi.agent.post(`/api/groups/${id}/leave`).send({}),
        ama.agent.post(`/api/groups/${id}/expenses`).send({ description: "Race", amount: "7", participant_ids: [ids.ama, ids.kwesi] }),
      ]);
      // Exactly one of them can win.
      expect([leave.status, bill.status].sort()).toEqual(leave.status === 200 ? [200, 400] : [201, 409]);
      const kwesiRow = (await pool.query("SELECT left_at FROM members WHERE id = $1", [ids.kwesi])).rows[0];
      const state = await stateFor(ama, id);
      const kwesiNet = state.balances.find((b) => b.memberId === ids.kwesi)?.netCents ?? 0;
      if (kwesiRow.left_at) expect(kwesiNet).toBe(0);
    }
  });
});
