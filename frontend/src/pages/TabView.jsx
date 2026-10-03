import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api, { errorMessage, post } from "../api";
import { CurrencyContext, formatCents, useMoney } from "../utils/money";
import { dateLabel } from "../utils/dates";
import { Icon, Initial } from "../components/Icons.jsx";

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
        <p className="error-banner" role="alert">
          <Icon name="alert" size={20} />
          <span>{loadError}</span>
        </p>
        <p className="center"><Link className="btn-ghost btn-link" to="/">Back to your tabs</Link></p>
      </div>
    );
  }
  if (!state)
    return (
      <div className="page tab-page">
        <div className="skeleton-list" role="status" aria-live="polite">
          <span className="sr-only">Loading this tab…</span>
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-hero" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      </div>
    );

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
    <CurrencyContext.Provider value={group.currency}>
    <div className="page tab-page">
      <p className="crumb">
        <Link to="/"><Icon name="back" size={16} /> Your tabs</Link>
      </p>

      <header className="tab-head">
        <h1 className="tab-title">{group.name}</h1>
        <ul className="people" aria-label={`${active.length} ${active.length === 1 ? "person" : "people"} on this tab`}>
          {active.map((m) => (
            <li key={m.id} className={`person${m.is_me ? " is-me" : ""}`}>
              <Initial name={m.name} />
              <span className="person-name">{m.name}</span>
              {m.is_me && <span className="person-tag">(you)</span>}
              {m.is_owner && <span className="person-tag owner-tag">started it</span>}
            </li>
          ))}
        </ul>
      </header>

      {actionError && (
        <p className="error-banner" role="alert">
          <Icon name="alert" size={20} />
          <span>{actionError}</span>
        </p>
      )}

      <div className="tab-grid">
        <div className="tab-main">
          <NeedsYou expenses={expenses} payments={payments} meId={me.member_id} act={act} busy={busy} />

          {group.is_owner && joinRequests.length > 0 && <JoinRequests joinRequests={joinRequests} act={act} busy={busy} />}

          <BalanceHero
            meId={me.member_id}
            myNet={myNet}
            settlement={settlement}
            payments={payments}
            hasExpenses={expenses.some((e) => !e.voided_at)}
            act={act}
            busy={busy}
          />

          <section className="ledger" aria-labelledby="expenses-heading">
            <h2 className="block-title" id="expenses-heading">Expenses</h2>

            <div className="totals">
              <div className="total-counted">
                <span className="total-label">Total counted</span>
                <span className="money total-value">{formatCents(liveTotal, { currency: group.currency })}</span>
              </div>
              {uncounted > 0 && (
                <div className="total-pending">
                  <span className="total-label">Not counted yet</span>
                  <span className="money total-value">{formatCents(uncounted, { currency: group.currency })}</span>
                </div>
              )}
            </div>
            {uncounted > 0 && (
              <p className="muted small total-note">
                The dashed amount is waiting to be accepted or is in dispute. It isn't counted until it's agreed.
              </p>
            )}

            <ExpenseList expenses={expenses} members={members} meId={me.member_id} act={act} busy={busy} />

            <AddExpense members={active} meId={me.member_id} act={act} busy={busy} />
          </section>
        </div>

        <aside className="tab-side">
          <BalancesList balances={balances} meId={me.member_id} />
          {group.is_owner && <OwnerPanel group={group} members={active} act={act} busy={busy} />}
          <PaymentsPanel members={active} meId={me.member_id} payments={payments} act={act} busy={busy} />
          <p className="muted small rules-note">
            <Icon name="lock" size={14} /> Nothing changes what anyone owes without their OK: a charge counts once that person accepts it, and a
            payment counts once the person who received it confirms. Only the payer can void an expense, and nothing is ever deleted — it all stays
            in the history.
          </p>
          {!group.is_owner && <LeaveTab myNet={myNet} onLeave={leave} busy={busy} />}
        </aside>
      </div>
    </div>
    </CurrencyContext.Provider>
  );
}

// ── Owner: people waiting to be let in ───────────────────────────────────

function JoinRequests({ joinRequests, act, busy }) {
  return (
    <section className="needs-you join-requests" aria-label="People waiting to join">
      <h2 className="panel-title">
        <Icon name="clock" size={18} /> Waiting to join
      </h2>
      <ul className="ask-list">
        {joinRequests.map((r) => (
          <li key={r.user_id} className="ask">
            <span className="ask-text request-who">
              <strong>{r.name}</strong>
              <span className="small">{r.email}</span>
            </span>
            <span className="ask-actions">
              <button type="button" className="btn-solid-sm" disabled={busy} onClick={() => act(`/requests/${r.user_id}/approve`)}>
                Let in
              </button>
              <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act(`/requests/${r.user_id}/decline`)}>
                Decline
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Owner: invite link and removing people ──────────────────────────────

function OwnerPanel({ group, members, act, busy }) {
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
    <section className="side-block owner-panel" aria-label="Manage this tab">
      <h2 className="block-title">Invite people</h2>
      {link ? (
        <>
          <div className="invite-row">
            <input className="invite-input" value={link} readOnly onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <button type="button" className="btn-ghost-sm" onClick={copy}>
              <Icon name={copied ? "check" : "copy"} size={16} />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="muted small">
            Anyone with this link can <em>ask</em> to join — you approve each person. Shared it with the wrong person?
          </p>
          <div className="inline-actions">
            <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act("/invite/regenerate")}>
              Make a new link
            </button>
            <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act("/invite/disable")}>
              Turn it off
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">Invites are off, so nobody new can ask to join.</p>
          <div className="inline-actions">
            <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act("/invite/regenerate")}>
              Turn on with a new link
            </button>
          </div>
        </>
      )}

      {members.length > 1 && (
        <details className="quiet-details people-detail">
          <summary>Remove someone</summary>
          <p className="muted small">People can only be removed once they're square (zero balance, nothing pending).</p>
          <ul className="plain-list">
            {members
              .filter((m) => !m.is_owner)
              .map((m) => (
                <li key={m.id} className="line-row">
                  <span className="person"><Initial name={m.name} /><span className="person-name">{m.name}</span></span>
                  <ConfirmButton
                    label="Remove"
                    confirmLabel={`Remove ${m.name}? They lose access to this tab.`}
                    className="btn-danger-sm"
                    danger
                    disabled={busy}
                    onConfirm={() => act(`/members/${m.id}/remove`)}
                  />
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────

const SHARE_ICON = { pending: "clock", declined: "alert", withdrawn: "ban" };

function ExpenseList({ expenses, members, meId, act, busy }) {
  const { fmt } = useMoney();
  const activeIds = members.filter((m) => !m.left_at).map((m) => m.id).sort((a, b) => a - b).join(",");
  if (expenses.length === 0) {
    return (
      <div className="empty-state compact">
        <Icon name="receipt" size={32} />
        <p className="empty-title">Nothing on the tab yet.</p>
        <p className="muted small">Add the first expense below. Everyone you split it with will be asked to accept their share.</p>
      </div>
    );
  }

  const renderEntry = (exp) => {
    const voided = Boolean(exp.voided_at);
    const shareIds = exp.shares.map((s) => s.member_id).sort((a, b) => a - b).join(",");
    const splitText =
      shareIds === activeIds && !voided
        ? "Split evenly"
        : `Split with ${exp.shares.map((s) => (s.member_id === meId ? "you" : s.name)).join(", ")}`;
    const unanswered = exp.shares.filter((s) => s.status !== "accepted");
    const counted = exp.shares.filter((s) => s.status === "accepted").reduce((sum, s) => sum + s.share_cents, 0);
    const partly = !voided && counted < exp.amount_cents;
    const pct = exp.amount_cents > 0 ? Math.max(0, Math.min(100, Math.round((counted / exp.amount_cents) * 100))) : 0;
    const state = voided ? "is-voided" : unanswered.length === 0 ? "is-counted" : unanswered.some((s) => s.status === "declined") ? "is-disputed" : "is-waiting";
    return (
      <li key={exp.id} className={`entry item-row ${state}`}>
        <div className="entry-head">
          <span className="entry-desc item-desc">{exp.description}</span>
          <span className="money entry-amount item-amount">{fmt(exp.amount_cents)}</span>
        </div>
        <div className="entry-sub">
          <span>{exp.payer_id === meId ? "You" : exp.payer_name} paid</span>
          <span className="entry-date">{dateLabel(exp.created_at)}</span>
        </div>
        <p className="entry-split">{splitText}</p>
        {partly && (
          <div className="entry-count">
            <span className="meter" aria-hidden="true" style={{ "--p": `${pct}%` }} />
            <span className="entry-counted">
              Counted {fmt(counted)} of {fmt(exp.amount_cents)}
            </span>
          </div>
        )}
        <div className="entry-foot">
          <span className="chips">
            {voided && (
              <span className="chip chip--voided">
                <Icon name="ban" size={14} />
                Voided by {exp.voided_by_name} {dateLabel(exp.voided_at)}
              </span>
            )}
            {!voided && unanswered.length === 0 && (
              <span className="chip chip--counted">
                <Icon name="check" size={14} />
                Counted
              </span>
            )}
            {!voided &&
              unanswered.map((sh) => (
                <span key={sh.member_id} className={`chip chip--${sh.status}`}>
                  <Icon name={SHARE_ICON[sh.status] || "clock"} size={14} />
                  {sh.member_id === meId ? "You" : sh.name}: {SHARE_LABEL[sh.status]}
                </span>
              ))}
          </span>
          {!voided && exp.payer_id === meId && (
            <ConfirmButton
              label="Void"
              confirmLabel="Void this expense? It stops counting for everyone."
              className="btn-danger-sm item-remove"
              danger
              disabled={busy}
              onConfirm={() => act(`/expenses/${exp.id}/void`)}
            />
          )}
        </div>
      </li>
    );
  };

  const live = expenses.filter((e) => !e.voided_at);
  const voidedList = expenses.filter((e) => e.voided_at);
  return (
    <>
      {live.length > 0 && <ul className="entries item-list">{live.map(renderEntry)}</ul>}
      {voidedList.length > 0 && (
        <details className="quiet-details voided-group">
          <summary>Voided ({voidedList.length})</summary>
          <ul className="entries item-list">{voidedList.map(renderEntry)}</ul>
        </details>
      )}
    </>
  );
}

function AddExpense({ members, meId, act, busy }) {
  const { symbol } = useMoney();
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
      <div className="add-bar">
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
      </div>
    );
  }

  return (
    <form className="expense-form" onSubmit={submit}>
      <h3 className="form-title">New expense</h3>
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
        <span className="input-prefix">
          <span className="prefix" aria-hidden="true">{symbol}</span>
          <input style={{ paddingLeft: symbol.length > 1 ? 56 : 30 }} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" required />
        </span>
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

// ── Balance: the hero ────────────────────────────────────────────────────

function BalanceHero({ meId, myNet, settlement, payments, hasExpenses, act, busy }) {
  const { fmt } = useMoney();
  const myClaims = payments.filter((p) => p.status === "pending" && p.recorded_by_id === meId);
  const kind = myNet > 0 ? "owed" : myNet < 0 ? "owe" : "square";

  return (
    <section className={`balance is-${kind}`} aria-label="Your balance">
      <div className="balance-top">
        <p className="balance-line my-standing">
          {kind === "owed" && (
            <>
              <span className="balance-label"><Icon name="in" size={22} />You're owed</span> <span className="balance-amount money">{fmt(myNet)}</span>
            </>
          )}
          {kind === "owe" && (
            <>
              <span className="balance-label"><Icon name="out" size={22} />You owe</span> <span className="balance-amount money">{fmt(-myNet)}</span>
            </>
          )}
          {kind === "square" && (
            <span className="balance-label"><Icon name="check" size={22} />You're square</span>
          )}
        </p>
        <p className="balance-sub">
          {kind === "square" ? "Nothing owed either way. Only accepted amounts count." : "Counts only what everyone has accepted."}
        </p>
      </div>

      <div className="balance-body">
        <h2 className="block-title">Settle up</h2>
        {settlement.length === 0 ? (
          hasExpenses ? (
            <p className="stamp"><Icon name="check" size={18} /> All settled</p>
          ) : (
            <p className="muted">Add an expense to see who owes whom.</p>
          )
        ) : (
          <ul className="settle-list">
            {settlement.map((t) => {
              const iOwe = t.fromId === meId;
              const owedToMe = t.toId === meId;
              const claimed = myClaims.some((p) => p.to_id === t.toId);
              return (
                <li key={`${t.fromId}-${t.toId}`} className="settle-row">
                  <span className="settle-who">
                    <Initial name={t.fromName} />
                    <span className="settle-text">
                      <span className="settle-from">{iOwe ? "You" : t.fromName}</span> <span className="settle-arrow">{iOwe ? "owe" : "owes"}</span>{" "}
                      <span className="settle-to">{owedToMe ? "you" : t.toName}</span>
                    </span>
                  </span>
                  <span className="settle-amount money">{fmt(t.amountCents)}</span>
                  {iOwe && !claimed && (
                    <span className="row-actions">
                      <ConfirmButton
                        label="I've paid this"
                        confirmLabel={`Tell ${t.toName} you paid ${fmt(t.amountCents)}?`}
                        className="btn-solid-sm"
                        disabled={busy}
                        onConfirm={() => act("/payments", { direction: "sent", counterparty_id: t.toId, amount: (t.amountCents / 100).toFixed(2) })}
                      />
                    </span>
                  )}
                  {owedToMe && (
                    <span className="row-actions">
                      <ConfirmButton
                        label="They paid me"
                        confirmLabel={`Mark ${fmt(t.amountCents)} from ${t.fromName} as received?`}
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
              <li key={p.id} className="settle-row is-pending">
                <span className="pending-text">
                  <Icon name="clock" size={16} />
                  <span>Waiting for {p.to_name} to confirm your {fmt(p.amount_cents)}</span>
                </span>
                <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act(`/payments/${p.id}/cancel`)}>
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function BalancesList({ balances, meId }) {
  const { fmt } = useMoney();
  if (balances.length === 0) return null;
  return (
    <section className="side-block" aria-labelledby="balances-heading">
      <h2 className="block-title" id="balances-heading">Everyone's balance</h2>
      <ul className="plain-list">
        {balances.map((b) => (
          <li key={b.memberId} className="line-row">
            <span className="person">
              <Initial name={b.name} />
              <span className="person-name">{b.memberId === meId ? "You" : b.name}</span>
            </span>
            <span className={`balance-chip ${b.netCents > 0 ? "is-credit" : b.netCents < 0 ? "is-debit" : "is-square"}`}>
              <Icon name={b.netCents > 0 ? "in" : b.netCents < 0 ? "out" : "check"} size={14} />
              <span className="money">
                {b.netCents > 0 ? `is owed ${fmt(b.netCents)}` : b.netCents < 0 ? `owes ${fmt(-b.netCents)}` : "square"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PaymentsPanel({ members, meId, payments, act, busy }) {
  const others = members.filter((m) => m.id !== meId);
  return (
    <section className="side-block" aria-labelledby="payments-heading">
      <h2 className="block-title" id="payments-heading">Payments</h2>
      {others.length > 0 && <RecordPayment others={others} act={act} busy={busy} />}
      <PaymentHistory payments={payments} meId={meId} act={act} busy={busy} />
      {others.length === 0 && payments.length === 0 && <p className="muted small">Payments between people on this tab show up here.</p>}
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
    <details className="quiet-details">
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

const STATUS_LABEL = { pending: "Waiting", confirmed: "Confirmed", declined: "Declined", voided: "Cancelled" };
const STATUS_ICON = { pending: "clock", confirmed: "check", declined: "alert", voided: "ban" };

function PaymentHistory({ payments, meId, act, busy }) {
  const { fmt } = useMoney();
  if (payments.length === 0) return null;
  return (
    <details className="quiet-details">
      <summary>Payment history ({payments.length})</summary>
      <ul className="plain-list">
        {payments.map((p) => (
          <li key={p.id} className={`pay-row history-row status-${p.status}`}>
            <span className="pay-main">
              <span className="pay-who">
                {p.from_id === meId ? "You" : p.from_name} paid {p.to_id === meId ? "you" : p.to_name}
              </span>
              <span className="pay-meta">
                <span className={`chip chip--pay-${p.status}`}>
                  <Icon name={STATUS_ICON[p.status] || "clock"} size={14} />
                  {STATUS_LABEL[p.status]}
                </span>
                <span className="muted small">{dateLabel(p.created_at)}</span>
              </span>
            </span>
            <span className="history-amount money">{fmt(p.amount_cents)}</span>
            {p.status === "confirmed" &&
              (p.from_id === meId || (p.to_id === meId && Date.now() - new Date(p.resolved_at).getTime() < UNDO_GRACE_MS)) && (
                <ConfirmButton
                  label="Undo"
                  confirmLabel="Undo this payment? It stops counting."
                  className="btn-danger-sm item-remove"
                  danger
                  disabled={busy}
                  onConfirm={() => act(`/payments/${p.id}/void`)}
                />
              )}
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
        <ConfirmButton
          label="Leave this tab"
          confirmLabel="Leave for good? You'll lose access."
          className="btn-danger"
          danger
          disabled={busy}
          onConfirm={onLeave}
        />
      ) : (
        <p className="muted small">You can leave this tab once you're square.</p>
      )}
    </section>
  );
}

// Everything waiting on YOUR answer: charges to accept or decline, and
// payments people say they've sent you.
function NeedsYou({ expenses, payments, meId, act, busy }) {
  const { fmt } = useMoney();
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
      <h2 className="panel-title">
        <Icon name="clock" size={18} /> Needs your OK
      </h2>
      <ul className="ask-list">
        {charges.map(({ expense, share }) => (
          <li key={`e${expense.id}`} className="ask">
            <span className="ask-text">
              <strong>{expense.payer_name}</strong> added <em>{expense.description}</em> ({fmt(expense.amount_cents)})
              — your share
            </span>
            <span className="ask-amount money">{fmt(share.share_cents)}</span>
            <span className="ask-actions">
              <button type="button" className="btn-solid-sm" disabled={busy} onClick={() => act(`/expenses/${expense.id}/accept`)}>
                Accept
              </button>
              <ConfirmButton
                label="Decline"
                confirmLabel="Dispute this? Everyone will see it, and neither of you can leave the tab until it's settled."
                className="btn-danger-sm"
                danger
                disabled={busy}
                onConfirm={() => act(`/expenses/${expense.id}/decline`)}
              />
            </span>
          </li>
        ))}
        {againstMe.map(({ expense, share }) => (
          <li key={`d${expense.id}-${share.member_id}`} className="ask dispute-row">
            <span className="ask-text">
              <strong>{share.name}</strong> disputes their share of <em>{expense.description}</em>
            </span>
            <span className="ask-amount money">{fmt(share.share_cents)}</span>
            <span className="ask-actions">
              <ConfirmButton
                label="Withdraw the charge"
                confirmLabel={`Drop ${fmt(share.share_cents)} from ${share.name}?`}
                className="btn-ghost-sm"
                disabled={busy}
                onConfirm={() => act(`/expenses/${expense.id}/shares/${share.member_id}/withdraw`)}
              />
            </span>
          </li>
        ))}
        {myDeclines.map(({ expense, share }) => (
          <li key={`m${expense.id}`} className="ask dispute-row">
            <span className="ask-text">
              You disputed your share of <strong>{expense.payer_name}</strong>'s <em>{expense.description}</em>
            </span>
            <span className="ask-amount money">{fmt(share.share_cents)}</span>
            <span className="ask-actions">
              <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act(`/expenses/${expense.id}/accept`)}>
                Accept after all
              </button>
            </span>
          </li>
        ))}
        {incoming.map((p) => (
          <li key={`p${p.id}`} className="ask">
            <span className="ask-text">
              <strong>{p.from_name}</strong> says they paid you
            </span>
            <span className="ask-amount money">{fmt(p.amount_cents)}</span>
            <span className="ask-actions">
              <button type="button" className="btn-solid-sm" disabled={busy} onClick={() => act(`/payments/${p.id}/confirm`)}>
                Yes, I got it
              </button>
              <button type="button" className="btn-ghost-sm" disabled={busy} onClick={() => act(`/payments/${p.id}/decline`)}>
                No
              </button>
            </span>
          </li>
        ))}
      </ul>
      {(againstMe.length > 0 || myDeclines.length > 0) && (
        <p className="small ask-note">
          A disputed charge doesn't count, but neither side can leave the tab until one of you gives way.
        </p>
      )}
    </section>
  );
}

// A two-step button for anything consequential, so a stray tap can't do it.
// `danger` only changes how the question looks (red for things that can't be
// taken back, blue for routine confirmations).
function ConfirmButton({ label, confirmLabel, onConfirm, disabled, className = "link-btn", danger = false }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className={`confirm-inline${danger ? " is-danger" : ""}`}>
      <span className="confirm-text">{confirmLabel}</span>
      <span className="confirm-actions">
        <button
          type="button"
          className={danger ? "btn-danger-solid" : "btn-solid-sm"}
          disabled={disabled}
          onClick={async () => {
            setAsking(false);
            await onConfirm();
          }}
        >
          Yes
        </button>
        <button type="button" className="btn-ghost-sm" onClick={() => setAsking(false)}>
          No
        </button>
      </span>
    </span>
  );
}
