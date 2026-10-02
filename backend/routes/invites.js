const express = require("express");
const pool = require("../db");
const { isInviteToken, MAX_PENDING_REQUESTS_PER_GROUP } = require("../lib/validation");
const { asyncHandler, HttpError } = require("../lib/http");

const router = express.Router();

// An invite link doesn't let anyone IN — it only lets a logged-in person
// ask to join. The owner approves or declines each request. So a link that
// gets forwarded or leaked exposes the tab's name and nothing else.
const INVALID = () => new HttpError(404, "This invite link isn't valid any more. Ask the tab's owner for a new one.");

async function findByToken(db, token, { lock = false } = {}) {
  if (!isInviteToken(token)) return null;
  const r = await db.query(
    `SELECT g.id, g.name, u.display_name AS owner_name,
       (SELECT count(*)::int FROM members m WHERE m.group_id = g.id AND m.left_at IS NULL) AS member_count
     FROM groups g JOIN users u ON u.id = g.owner_id
     WHERE g.invite_token = $1 ${lock ? "FOR UPDATE OF g" : ""}`,
    [token]
  );
  return r.rows[0] || null;
}

async function statusFor(db, groupId, userId) {
  const member = await db.query(
    "SELECT 1 FROM members WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL",
    [groupId, userId]
  );
  if (member.rows.length) return "member";
  const request = await db.query("SELECT 1 FROM join_requests WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
  return request.rows.length ? "requested" : "none";
}

function present(group, status) {
  return {
    invite: {
      group_name: group.name,
      owner_name: group.owner_name,
      member_count: group.member_count,
      status,
      // The tab's id is only revealed to people who are already in it.
      group_id: status === "member" ? group.id : undefined,
    },
  };
}

router.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const group = await findByToken(pool, req.params.token);
    if (!group) throw INVALID();
    res.json(present(group, await statusFor(pool, group.id, req.user.id)));
  })
);

router.post(
  "/:token/request",
  asyncHandler(async (req, res) => {
    const result = await pool.withTransaction(async (client) => {
      const group = await findByToken(client, req.params.token, { lock: true });
      if (!group) throw INVALID();
      const status = await statusFor(client, group.id, req.user.id);
      if (status !== "none") return present(group, status);

      const pending = await client.query("SELECT count(*)::int AS n FROM join_requests WHERE group_id = $1", [group.id]);
      if (pending.rows[0].n >= MAX_PENDING_REQUESTS_PER_GROUP) {
        throw new HttpError(429, "This tab has too many people waiting to join. Ask the owner to clear them.");
      }
      await client.query("INSERT INTO join_requests (group_id, user_id) VALUES ($1, $2)", [group.id, req.user.id]);
      return present(group, "requested");
    });
    res.status(201).json(result);
  })
);

module.exports = router;
