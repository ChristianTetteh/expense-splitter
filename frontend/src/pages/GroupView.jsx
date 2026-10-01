import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import { formatCents } from "../utils/money";
import { dateLabel } from "../utils/dates";

export default function GroupView() {
  const { id } = useParams();
  const [group, setGroup] = useState(null);
  const [expenses, setExpenses] = useState(null);
  const [balances, setBalances] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [loadError, setLoadError] = useState("");

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [payerId, setPayerId] = useState("");
  const [participantIds, setParticipantIds] = useState(new Set());
  const [expenseError, setExpenseError] = useState("");
  const [savingExpense, setSavingExpense] = useState(false);

  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [memberError, setMemberError] = useState("");
  const [savingMember, setSavingMember] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/groups/${id}`)
      .then((res) => {
        if (cancelled) return;
        setGroup(res.data.group);
        setPayerId(String(res.data.group.members[0]?.id || ""));
        setParticipantIds(new Set(res.data.group.members.map((m) => m.id)));
      })
      .catch(() => !cancelled && setLoadError("Couldn't find that tab. Check the link and try again."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!group) return;
    refreshExpenses();
    refreshBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  function refreshExpenses() {
    return api
      .get(`/groups/${id}/expenses`)
      .then((res) => setExpenses(res.data.expenses))
      .catch(() => setLoadError("Couldn't load the expense history."));
  }

  function refreshBalances() {
    return api
      .get(`/groups/${id}/balances`)
      .then((res) => {
        setBalances(res.data.balances);
        setSettlement(res.data.settlement);
      })
      .catch(() => setLoadError("Couldn't load the balances."));
  }

  function toggleParticipant(memberId) {
    setParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  async function handleAddExpense(e) {
    e.preventDefault();
    setExpenseError("");
    if (participantIds.size === 0) {
      setExpenseError("Pick at least one person to split this between.");
      return;
    }
    setSavingExpense(true);
    try {
      await api.post(`/groups/${id}/expenses`, {
        description,
        amount,
        payer_id: Number(payerId),
        participant_ids: [...participantIds],
      });
      setDescription("");
      setAmount("");
      setShowAddExpense(false);
      await Promise.all([refreshExpenses(), refreshBalances()]);
    } catch (err) {
      setExpenseError(err.response?.data?.error || "Couldn't add that expense. Try again.");
    } finally {
      setSavingExpense(false);
    }
  }

  async function handleDeleteExpense(expenseId) {
    try {
      await api.delete(`/expenses/${expenseId}`);
      await Promise.all([refreshExpenses(), refreshBalances()]);
    } catch {
      setLoadError("Couldn't delete that expense. Try again.");
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    setMemberError("");
    setSavingMember(true);
    try {
      const res = await api.post(`/groups/${id}/members`, { name: newMemberName });
      setGroup((prev) => ({ ...prev, members: [...prev.members, res.data.member] }));
      setParticipantIds((prev) => new Set([...prev, res.data.member.id]));
      setNewMemberName("");
      setShowAddMember(false);
    } catch (err) {
      setMemberError(err.response?.data?.error || "Couldn't add that person. Try again.");
    } finally {
      setSavingMember(false);
    }
  }

  if (loadError) return <div className="page"><p className="error-banner">{loadError}</p></div>;
  if (!group) return <div className="page"><p className="muted">Loading…</p></div>;

  const total = (expenses || []).reduce((sum, e) => sum + e.amount_cents, 0);
  const allSettled = settlement && settlement.length === 0 && (expenses || []).length > 0;

  return (
    <div className="page">
      <div className="receipt">
        <div className="receipt-perforation" aria-hidden="true" />

        <header className="receipt-head">
          <p className="receipt-shop">{group.name}</p>
          <p className="receipt-sub">
            {group.members.length} {group.members.length === 1 ? "person" : "people"} on this tab
          </p>
          <ul className="member-chips">
            {group.members.map((m) => (
              <li key={m.id} className="member-chip">
                {m.name}
              </li>
            ))}
          </ul>
          {showAddMember ? (
            <form className="add-member-form" onSubmit={handleAddMember}>
              <input
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Add a person"
                maxLength={50}
                autoFocus
              />
              <button className="btn-ghost-sm" type="submit" disabled={savingMember}>
                {savingMember ? "Adding…" : "Add"}
              </button>
              <button type="button" className="btn-ghost-sm" onClick={() => setShowAddMember(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="link-btn" onClick={() => setShowAddMember(true)}>
              + add someone to the tab
            </button>
          )}
          {memberError && <p className="form-error">{memberError}</p>}
        </header>

        <div className="receipt-rule" aria-hidden="true" />

        <section className="receipt-items">
          {expenses === null ? (
            <p className="muted">Loading…</p>
          ) : expenses.length === 0 ? (
            <p className="muted">Nothing on the tab yet. Add the first expense below.</p>
          ) : (
            <ul className="item-list">
              {expenses.map((exp) => (
                <li key={exp.id} className="item-row">
                  <div className="item-row-main">
                    <span className="item-desc">{exp.description}</span>
                    <span className="item-amount">{formatCents(exp.amount_cents)}</span>
                  </div>
                  <div className="item-row-meta">
                    <span>
                      {exp.payer_name} paid · split {exp.participants.length === group.members.length ? "evenly" : `with ${exp.participants.length}`}
                      {" · "}
                      {dateLabel(exp.created_at)}
                    </span>
                    <button type="button" className="item-remove" onClick={() => handleDeleteExpense(exp.id)}>
                      remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="receipt-rule" aria-hidden="true" />

        <div className="receipt-total">
          <span>Total</span>
          <span>{formatCents(total)}</span>
        </div>

        {showAddExpense ? (
          <form className="expense-form" onSubmit={handleAddExpense}>
            <label className="pad-field">
              <span>What was it for</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Jollof dinner"
                maxLength={200}
                autoFocus
              />
            </label>
            <label className="pad-field">
              <span>Amount</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
              />
            </label>
            <label className="pad-field">
              <span>Who paid</span>
              <select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
                {group.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="pad-field">
              <span>Split between</span>
              <ul className="participant-checks">
                {group.members.map((m) => (
                  <li key={m.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={participantIds.has(m.id)}
                        onChange={() => toggleParticipant(m.id)}
                      />
                      {m.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            {expenseError && <p className="form-error">{expenseError}</p>}
            <div className="expense-form-actions">
              <button className="btn-primary" type="submit" disabled={savingExpense}>
                {savingExpense ? "Adding…" : "Add to the tab"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowAddExpense(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn-primary btn-add-expense" onClick={() => setShowAddExpense(true)}>
            + Add an expense
          </button>
        )}
      </div>

      <section className="settle-section">
        <h2 className="settle-heading">Settle up</h2>
        {settlement === null ? (
          <p className="muted">Loading…</p>
        ) : allSettled ? (
          <div className="stamp">all settled</div>
        ) : settlement.length === 0 ? (
          <p className="muted">Add an expense to see who owes whom.</p>
        ) : (
          <ul className="settle-list">
            {settlement.map((t, i) => (
              <li key={i} className="settle-row">
                <span className="settle-from">{t.fromName}</span>
                <span className="settle-arrow" aria-hidden="true">owes</span>
                <span className="settle-to">{t.toName}</span>
                <span className="settle-amount">{formatCents(t.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}

        {balances && balances.length > 0 && (
          <details className="balances-detail">
            <summary>See each person's balance</summary>
            <ul className="balance-list">
              {balances.map((b) => (
                <li key={b.memberId} className="balance-row">
                  <span>{b.name}</span>
                  <span className={b.netCents > 0 ? "is-credit" : b.netCents < 0 ? "is-debit" : ""}>
                    {formatCents(b.netCents, { showSign: true })}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
