const request = require("supertest");
const app = require("../server");
const pool = require("../db");
const migrate = require("../migrate");

const PASSWORD = "correct horse battery";
let counter = 0;

async function resetDb() {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate({ closePool: false });
}

// A logged-in browser session for a brand-new user. supertest's agent keeps
// the session cookie between requests, like a real browser would.
async function newUser(name = "Ama") {
  const agent = request.agent(app);
  const email = `${name.toLowerCase().replace(/\W/g, "")}${++counter}@test.dev`;
  const res = await agent.post("/api/auth/signup").send({ email, display_name: name, password: PASSWORD });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, email, user: res.body.user };
}

async function createTab(owner, name = "Weekend trip") {
  const res = await owner.agent.post("/api/groups").send({ name });
  if (res.status !== 201) throw new Error(`create tab failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// The full, legitimate way in: request via the invite link, owner approves.
async function joinTab(owner, joiner, state) {
  const token = state.group.invite_token;
  const req = await joiner.agent.post(`/api/invites/${token}/request`).send({});
  if (req.status !== 201) throw new Error(`join request failed: ${req.status} ${JSON.stringify(req.body)}`);
  const ok = await owner.agent.post(`/api/groups/${state.group.id}/requests/${joiner.user.id}/approve`).send({});
  if (ok.status !== 200) throw new Error(`approve failed: ${ok.status} ${JSON.stringify(ok.body)}`);
  return ok.body;
}

async function stateFor(member, groupId) {
  const res = await member.agent.get(`/api/groups/${groupId}`);
  if (res.status !== 200) throw new Error(`load tab failed: ${res.status}`);
  return res.body;
}

const memberIdOf = (state, name) => state.members.find((m) => m.name === name).id;
const netOf = (state, name) => state.balances.find((b) => b.name === name).netCents;

module.exports = { app, pool, request, PASSWORD, resetDb, newUser, createTab, joinTab, stateFor, memberIdOf, netOf };
