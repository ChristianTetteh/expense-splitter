import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api, { errorMessage, post } from "../api";
import { formatCents } from "../utils/money";
import { dateLabel } from "../utils/dates";

export default function TabView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return api
      .get(`/groups/${encodeURIComponent(id)}`)
      .then((res) => {
        setState(res.data);
        setLoadError("");
      })
      .catch((err) => setLoadError(errorMessage(err, "Couldn't load this tab.")));
  }, [id]);

  useEffect(() => {
    load();
    // Other people change the tab too; refresh whenever you come back to it.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Every write returns the tab's full, fresh state.
  const act = useCallback(
    async (path, body) => {
      setBusy(true);
      setActionError("");
      try {
        const res = await post(`/groups/${encodeURIComponent(id)}${path}`, body);
        setState(res.data);
        return true;
      } catch (err) {
        setActionError(errorMessage(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [id]
  );

  if (loadError && !state) {
    return (
      <div className="page">
        <p className="error-banner">{loadError}</p>
        <p className="center"><Link to="/">Back to your tabs</Link></p>
      </div>
    );
  }
  if (!state) return <div className="page"><p className="muted">Loading…</p></div>;

  const { group, me, members, expenses, payments, balances, settlement, join_requests: joinRequests } = state;
  const active = members.filter((m) => !m.left_at);
  const myNet = balances.find((b) => b.memberId === me.member_id)?.netCents ?? 0;
  // Only what's actually in force: accepted shares of expenses that haven't
  // been voided. Pending or disputed amounts are shown separately.
  const countedOf = (e) => e.shares.filter((s) => s.status === "accepted").reduce((sum, s) => sum + s.share_cents, 0);
  const liveExpenses = expenses.filter((e) => !e.voided_at);
  const liveTotal = liveExpenses.reduce((sum, e) => sum + countedOf(e), 0);
  const uncounted = liveExpenses.reduce((sum, e) => sum + e.amount_cents - countedOf(e), 0);

  async function leave() {
    setBusy(true);
    setActionError("");
    try {
      await post(`/groups/${encodeURIComponent(id)}/leave`);
      navigate("/", { replace: true });
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <p className="crumb"><Link to="/">← Your tabs</Link></p>

      {actionError && <p className="error-banner" role="alert">{actionError}</p>}

      <NeedsYou expenses={expenses} payments={payments} meId={me.member_id} act={act} busy={busy} />

      <div className="receipt">
        <div className="receipt-perforation" aria-hidden="true" />

        <header className="receipt-head">
          <p className="receipt-shop">{group.name}</p>
          <p className="receipt-sub">
            {active.length} {active.length === 1 ? "person" : "people"} on this tab
          </p>
          <ul className="member-chips">
            {active.map((m) => (
              <li key={m.id} className={`member-chip${m.is_me ? " is-me" : ""}`}>
                {m.name}
                {m.is_me ? " (you)" : ""}
                {m.is_owner ? " ★" : ""}
              </li>
            ))}
          </ul>
        </header>

        {group.is_owner && (
          <OwnerPanel group={group} members={active} joinRequests={joinRequests} act={act} busy={busy} />
        )}

        <div className="receipt-rule" aria-hidden="true" />

        <ExpenseList expenses={expenses} members={members} meId={me.member_id} act={act} busy={busy} />

        <div className="receipt-rule" aria-hidden="true" />

        <div className="receipt-total">
          <span>Total counted</span>
          <span>{formatCents(liveTotal)}</span>
        </div>
        {uncounted > 0 && (
          <p className="muted small total-note">
            + {formatCents(uncounted)} waiting to be accepted or in dispute — not counted until it's agreed.
          </p>
        )}

        <AddExpense members={active} meId={me.member_id} act={act} busy={busy} />
      </div>

      <SettleUp
        meId={me.member_id}
        myNet={myNet}
        members={active}
        settlement={settlement}
        payments={payments}
        balances={balances}
        hasExpenses={expenses.some((e) => !e.voided_at)}
        act={act}
        busy={busy}
      />

      {!group.is_owner && (
        <LeaveTab myNet={myNet} onLeave={leave} busy={busy} />
      )}
    </div>
  );
}

// ── Owner: invite link, join requests, removing people ─────────────────

function OwnerPanel({ group, members, joinRequests, act, busy }) {
  const [copied, setCopied] = useState(false);
  const link = group.invite_token ? `${window.location.origin}/join/${group.invite_token}` : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="owner-panel" aria-label="Manage this tab">
      <div className="receipt-rule" aria-hidden="true" />
      <p className="panel-label">Invite link</p>
      {link ? (
        <>
          <div className="invite-row">
            <input className="invite-input" value={link} readOnly onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <button type="button" className="btn-ghost-sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="muted small">
            Anyone with this link can <em>ask</em> to join — you approve each person. Shared it with the wrong person?{" "}
            <button type="button" className="link-btn inline" disabled={busy} onClick={() => act("/invite/regenerate")}>
              Make a new link
            </button>{" "}
            or{" "}
            <button type="button" className="link-btn inline" disabled={busy} onClick={() => act("/invite/disable")}>
              turn it off
            </button>
            .
          </p>
        </>
      ) : (
        <p className="muted small">
          Invites are off.{" "}
          <button type="button" className="link-btn inline" disabled={busy} onClick={() => act("/invite/regenerate")}>
            Turn on with a new link
          </button>
        </p>
      )}

      {joinRequests.length > 0 && (
        <>
          <p className="panel-label">Waiting to join</p>
          <ul className="request-list">
            {joinRequests.map((r) => (
              <li key={r.user_id} className="request-row">
                <span className="request-who">
                  <strong>{r.name}</strong>
                  <span className="muted small">{r.email}</span>
                </span>
                <span className="request-actions">
                  <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act(`/requests/${r.user_id}/approve`)}>
                    Let in
                  </button>
                  <button type="button" className="link-btn" disabled={busy} onClick={() => act(`/requests/${r.user_id}/decline`)}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {members.length > 1 && (
        <details className="people-detail">
          <summary>Remove someone</summary>
          <p className="muted small">People can only be removed once they're square (zero balance, nothing pending).</p>
          <ul className="request-list">
            {members
              .filter((m) => !m.is_owner)
              .map((m) => (
                <li key={m.id} className="request-row">
                  <span>{m.name}</span>
                  <ConfirmButton label="Remove" confirmLabel={`Remove ${m.name}?`} disabled={busy} onConfirm={() => act(`/members/${m.id}/remove`)} />
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────

function ExpenseList({ expenses, members, meId, act, busy }) {
  const activeIds = members.filter((m) => !m.left_at).map((m) => m.id).sort((a, b) => a - b).join(",");
  if (expenses.length === 0) {
    return <p className="muted">Nothing on the tab yet. Add the first expense below.</p>;
  }
  return (
    <ul className="item-list">
      {expenses.map((exp) => {
        const voided = Boolean(exp.voided_at);
        const shareIds = exp.shares.map((s) => s.member_id).sort((a, b) => a - b).join(",");
        const splitText =
          shareIds === activeIds && !voided
            ? "split evenly"
            : `split with ${exp.shares.map((s) => (s.member_id === meId ? "you" : s.name)).join(", ")}`;
        const unanswered = exp.shares.filter((s) => s.status !== "accepted");
        const counted = exp.shares.filter((s) => s.status === "accepted").reduce((sum, s) => sum + s.share_cents, 0);
        return (
          <li key={exp.id} className={`item-row${voided ? " is-voided" : ""}`}>
            <div className="item-row-main">
              <span className="item-desc">{exp.description}</span>
              <span className="item-amount">
                {formatCents(exp.amount_cents)}
                {!voided && counted < exp.amount_cents && <span className="counted-note">counted {formatCents(counted)}</span>}
              </span>
            </div>
            <div className="item-row-meta">
              <span>
                {exp.payer_id === meId ? "You" : exp.payer_name} paid · {splitText} · {dateLabel(exp.created_at)}
                {voided && <span className="void-note"> · voided by {exp.voided_by_name} {dateLabel(exp.voided_at)}</span>}
                {!voided && unanswered.length > 0 && (
                  <span className="share-status">
                    {unanswered.map((sh) => (
                      <span key={sh.member_id} className={`share-pill status-${sh.status}`}>
                        {sh.member_id === meId ? "You" : sh.name}: {SHARE_LABEL[sh.status]}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              {!voided && exp.payer_id === meId && (
                <ConfirmButton
                  label="void"
                  confirmLabel="Void it?"
                  className="item-remove"
                  disabled={busy}
                  onConfirm={() => act(`/expenses/${exp.id}/void`)}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AddExpense({ members, meId, act, busy }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [participants, setParticipants] = useState(() => new Set(members.map((m) => m.id)));
  const [error, setError] = useState("");

  function toggle(memberId) {
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    const chosen = members.filter((m) => participants.has(m.id)).map((m) => m.id);
    if (chosen.length === 0) {
      setError("Pick at least one person to split this between.");
      return;
    }
    const ok = await act("/expenses", { description, amount, participant_ids: chosen });
    if (ok) {
      setDescription("");
      setAmount("");
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-primary btn-add-expense"
        onClick={() => {
          setParticipants(new Set(members.map((m) => m.id)));
          setOpen(true);
        }}
      >
        + Add something you paid for
      </button>
    );
  }

  return (
    <form className="expense-form" onSubmit={submit}>
      <p className="muted small">
        You can only add expenses <strong>you</strong> paid. Each person you split with has to accept their share
        before it counts — nobody can be charged without agreeing.
      </p>
      <label className="pad-field">
        <span>What was it for</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Jollof dinner" maxLength={200} required autoFocus />
      </label>
      <label className="pad-field">
        <span>Amount you paid</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" required />
      </label>
      <fieldset className="pad-field plain-fieldset">
        <legend>Split between</legend>
        <ul className="participant-checks">
          {members.map((m) => (
            <li key={m.id}>
              <label>
                <input type="checkbox" checked={participants.has(m.id)} onChange={() => toggle(m.id)} />
                {m.id === meId ? "You" : m.name}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="expense-form-actions">
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add to the tab"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Settling up ──────────────────────────────────────────────────────────

function SettleUp({ meId, myNet, members, settlement, payments, balances, hasExpenses, act, busy }) {
  const myClaims = payments.filter((p) => p.status === "pending" && p.recorded_by_id === meId);
  const others = members.filter((m) => m.id !== meId);

  return (
    <section className="settle-section">
      <h2 className="settle-heading">Settle up</h2>

      <p className={`my-standing ${myNet > 0 ? "is-credit" : myNet < 0 ? "is-debit" : ""}`}>
        {myNet > 0 ? `You're owed ${formatCents(myNet)}` : myNet < 0 ? `You owe ${formatCents(-myNet)}` : "You're square"}
      </p>

      {settlement.length === 0 ? (
        hasExpenses ? <div className="stamp">all settled</div> : <p className="muted">Add an expense to see who owes whom.</p>
      ) : (
        <ul className="settle-list">
          {settlement.map((t) => {
            const iOwe = t.fromId === meId;
            const owedToMe = t.toId === meId;
            const claimed = myClaims.some((p) => p.to_id === t.toId);
            return (
              <li key={`${t.fromId}-${t.toId}`} className="settle-row">
                <span className="settle-from">{iOwe ? "You" : t.fromName}</span>
                <span className="settle-arrow" aria-hidden="true">{iOwe ? "owe" : "owes"}</span>
                <span className="settle-to">{owedToMe ? "you" : t.toName}</span>
                <span className="settle-amount">{formatCents(t.amountCents)}</span>
                {iOwe && !claimed && (
                  <span className="row-actions">
                    <ConfirmButton
                      label="I've paid this"
                      confirmLabel={`Tell ${t.toName} you paid ${formatCents(t.amountCents)}?`}
                      className="btn-ghost-sm"
                      disabled={busy}
                      onConfirm={() => act("/payments", { direction: "sent", counterparty_id: t.toId, amount: (t.amountCents / 100).toFixed(2) })}
                    />
                  </span>
                )}
                {owedToMe && (
                  <span className="row-actions">
                    <ConfirmButton
                      label="They paid me"
                      confirmLabel={`Mark ${formatCents(t.amountCents)} from ${t.fromName} as received?`}
                      className="btn-ghost-sm"
                      disabled={busy}
                      onConfirm={() => act("/payments", { direction: "received", counterparty_id: t.fromId, amount: (t.amountCents / 100).toFixed(2) })}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {myClaims.length > 0 && (
        <ul className="settle-list pending-list">
          {myClaims.map((p) => (
            <li key={p.id} className="settle-row muted">
              <span>Waiting for {p.to_name} to confirm your {formatCents(p.amount_cents)}</span>
              <button type="button" className="link-btn" disabled={busy} onClick={() => act(`/payments/${p.id}/cancel`)}>
                Withdraw
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="muted small rules-note">
        Nothing changes what anyone owes without their OK: a charge counts once that person accepts it, and a payment
        counts once the person who received it confirms. Only the payer can void an expense, and nothing is ever
        deleted — it all stays in the history.
      </p>

      {others.length > 0 && <RecordPayment others={others} act={act} busy={busy} />}

      <PaymentHistory payments={payments} meId={meId} act={act} busy={busy} />

      {balances.length > 0 && (
        <details className="balances-detail">
          <summary>See everyone's balance</summary>
          <ul className="balance-list">
            {balances.map((b) => (
              <li key={b.memberId} className="balance-row">
                <span>{b.memberId === meId ? "You" : b.name}</span>
                <span className={b.netCents > 0 ? "is-credit" : b.netCents < 0 ? "is-debit" : ""}>
                  {formatCents(b.netCents, { showSign: true })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function RecordPayment({ others, act, busy }) {
  const [direction, setDirection] = useState("sent");
  const [counterparty, setCounterparty] = useState(String(others[0].id));
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (!others.some((m) => String(m.id) === counterparty)) setCounterparty(String(others[0].id));
  }, [others, counterparty]);

  async function submit(e) {
    e.preventDefault();
    const ok = await act("/payments", { direction, counterparty_id: Number(counterparty), amount });
    if (ok) setAmount("");
  }

  return (
    <details className="balances-detail">
      <summary>Record a different amount</summary>
      <form className="payment-form" onSubmit={submit}>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Direction">
          <option value="sent">I paid</option>
          <option value="received">I was paid by</option>
        </select>
        <select value={counterparty} onChange={(e) => setCounterparty(e.target.value)} aria-label="Person">
          {others.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" aria-label="Amount" required />
        <button className="btn-ghost-sm" type="submit" disabled={busy}>
          Record
        </button>
      </form>
      <p className="muted small">
        {direction === "sent" ? "They'll be asked to confirm before it counts." : "This counts straight away — you're the one confirming it."}
      </p>
    </details>
  );
}

const SHARE_LABEL = { pending: "hasn't accepted yet", declined: "disputes this", withdrawn: "charge withdrawn" };

// Mirrors the server rule: the receiver can undo a confirmed payment only for
// a short while (typos); after that only the person who paid can.
const UNDO_GRACE_MS = 15 * 60 * 1000;

const STATUS_LABEL = { pending: "waiting", confirmed: "confirmed", declined: "declined", voided: "cancelled" };

function PaymentHistory({ payments, meId, act, busy }) {
  if (payments.length === 0) return null;
  return (
    <details className="balances-detail">
      <summary>Payment history ({payments.length})</summary>
      <ul className="balance-list">
        {payments.map((p) => (
          <li key={p.id} className={`history-row status-${p.status}`}>
            <span>
              {p.from_id === meId ? "You" : p.from_name} → {p.to_id === meId ? "you" : p.to_name}
              <span className="muted small"> · {dateLabel(p.created_at)} · {STATUS_LABEL[p.status]}</span>
            </span>
            <span className="history-amount">
              {formatCents(p.amount_cents)}
              {p.status === "confirmed" &&
                (p.from_id === meId || (p.to_id === meId && Date.now() - new Date(p.resolved_at).getTime() < UNDO_GRACE_MS)) && (
                <ConfirmButton
                  label="undo"
                  confirmLabel="Undo?"
                  className="item-remove"
                  disabled={busy}
                  onConfirm={() => act(`/payments/${p.id}/void`)}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function LeaveTab({ myNet, onLeave, busy }) {
  return (
    <section className="leave-section">
      {myNet === 0 ? (
        <ConfirmButton label="Leave this tab" confirmLabel="Leave for good? You'll lose access." className="link-btn danger" disabled={busy} onConfirm={onLeave} />
      ) : (
        <p className="muted small">You can leave this tab once you're square.</p>
      )}
    </section>
  );
}

// Everything waiting on YOUR answer: charges to accept or decline, and
// payments people say they've sent you.
function NeedsYou({ expenses, payments, meId, act, busy }) {
  const charges = [];
  for (const e of expenses) {
    if (e.voided_at || e.payer_id === meId) continue;
    const mine = e.shares.find((s) => s.member_id === meId && s.status === "pending");
    if (mine) charges.push({ expense: e, share: mine });
  }
  const incoming = payments.filter((p) => p.status === "pending" && p.to_id === meId);
  // Disputes: someone declined a charge you made, or you declined theirs.
  const againstMe = [];
  const myDeclines = [];
  for (const e of expenses) {
    if (e.voided_at) continue;
    for (const sh of e.shares) {
      if (sh.status !== "declined") continue;
      if (e.payer_id === meId) againstMe.push({ expense: e, share: sh });
      else if (sh.member_id === meId) myDeclines.push({ expense: e, share: sh });
    }
  }
  if (charges.length + incoming.length + againstMe.length + myDeclines.length === 0) return null;

  return (
    <section className="needs-you" aria-label="Waiting for your answer">
      <p className="panel-label">Needs your OK</p>
      <ul className="settle-list">
        {charges.map(({ expense, share }) => (
          <li key={`e${expense.id}`} className="settle-row">
            <span>
              <strong>{expense.payer_name}</strong> added <em>{expense.description}</em> ({formatCents(expense.amount_cents)})
              — your share
            </span>
            <span className="settle-amount">{formatCents(share.share_cents)}</span>
            <span className="row-actions">
              <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act(`/expenses/${expense.id}/accept`)}>
                Accept
              </button>
              <ConfirmButton
                label="Decline"
                confirmLabel="Dispute this? Everyone will see it, and neither of you can leave the tab until it's settled."
                disabled={busy}
                onConfirm={() => act(`/expenses/${expense.id}/decline`)}
              />
            </span>
          </li>
        ))}
        {againstMe.map(({ expense, share }) => (
          <li key={`d${expense.id}-${share.member_id}`} className="settle-row dispute-row">
            <span>
              <strong>{share.name}</strong> disputes their share of <em>{expense.description}</em>
            </span>
            <span className="settle-amount">{formatCents(share.share_cents)}</span>
            <span className="row-actions">
              <ConfirmButton
                label="Withdraw the charge"
                confirmLabel={`Drop ${formatCents(share.share_cents)} from ${share.name}?`}
                className="btn-ghost-sm"
                disabled={busy}
                onConfirm={() => act(`/expenses/${expense.id}/shares/${share.member_id}/withdraw`)}
              />
            </span>
          </li>
        ))}
        {myDeclines.map(({ expense, share }) => (
          <li key={`m${expense.id}`} className="settle-row dispute-row">
            <span>
              You disputed your share of <strong>{expense.payer_name}</strong>'s <em>{expense.description}</em>
            </span>
            <span className="settle-amount">{formatCents(share.share_cents)}</span>
            <span className="row-actions">
              <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act(`/expenses/${expense.id}/accept`)}>
                Accept after all
              </button>
            </span>
          </li>
        ))}
        {incoming.map((p) => (
          <li key={`p${p.id}`} className="settle-row">
            <span>
              <strong>{p.from_name}</strong> says they paid you
            </span>
            <span className="settle-amount">{formatCents(p.amount_cents)}</span>
            <span className="row-actions">
              <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act(`/payments/${p.id}/confirm`)}>
                Yes, I got it
              </button>
              <button type="button" className="link-btn" disabled={busy} onClick={() => act(`/payments/${p.id}/decline`)}>
                No
              </button>
            </span>
          </li>
        ))}
      </ul>
      {(againstMe.length > 0 || myDeclines.length > 0) && (
        <p className="muted small">
          A disputed charge doesn't count, but neither side can leave the tab until one of you gives way.
        </p>
      )}
    </section>
  );
}

// A two-step button for anything consequential, so a stray tap can't do it.
function ConfirmButton({ label, confirmLabel, onConfirm, disabled, className = "link-btn" }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-inline">
      <span className="small">{confirmLabel}</span>
      <button
        type="button"
        className="link-btn"
        disabled={disabled}
        onClick={async () => {
          setAsking(false);
          await onConfirm();
        }}
      >
        Yes
      </button>
      <button type="button" className="link-btn" onClick={() => setAsking(false)}>
        No
      </button>
    </span>
  );
}
