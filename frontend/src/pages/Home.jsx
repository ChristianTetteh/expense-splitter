import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { errorMessage, post } from "../api";
import { CURRENCIES, DEFAULT_CURRENCY, formatCents } from "../utils/money";
import { Icon, TallyMark } from "../components/Icons.jsx";

function standing(netCents, currency) {
  if (netCents > 0) return { text: `You're owed ${formatCents(netCents, { currency })}`, cls: "is-credit", icon: "in" };
  if (netCents < 0) return { text: `You owe ${formatCents(-netCents, { currency })}`, cls: "is-debit", icon: "out" };
  return { text: "You're square", cls: "is-square", icon: "check" };
}

export default function Home() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get("/groups")
      .then((res) => setGroups(res.data.groups))
      .catch((err) => setLoadError(errorMessage(err, "Couldn't load your tabs.")));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await post("/groups", { name, currency });
      navigate(`/tabs/${res.data.group.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="page home-page">
      <section className="tabs-section" aria-labelledby="tabs-heading">
        <h1 className="section-title" id="tabs-heading">Your tabs</h1>
        {loadError && (
          <p className="error-banner" role="alert">
            <Icon name="alert" size={20} />
            <span>{loadError}</span>
          </p>
        )}
        {groups === null && !loadError ? (
          <div className="skeleton-list" role="status" aria-live="polite">
            <span className="sr-only">Loading your tabs…</span>
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
          </div>
        ) : groups && groups.length === 0 ? (
          <div className="empty-state">
            <TallyMark size={44} />
            <p className="empty-title">No tabs yet.</p>
            <p className="muted">Start one, then send its invite link to the people you're splitting with. Nobody can see it until you let them in.</p>
          </div>
        ) : (
          <ul className="tab-list">
            {(groups || []).map((g) => {
              const s = standing(g.net_cents, g.currency);
              return (
                <li key={g.id}>
                  <Link to={`/tabs/${g.id}`} className={`tab-card ${s.cls}`}>
                    <span className="tab-card-name">{g.name}</span>
                    <span className="tab-card-meta">
                      {g.member_count} {g.member_count === 1 ? "person" : "people"}
                      {g.is_owner ? ", you started it" : ""}
                    </span>
                    <span className={`tab-card-standing ${s.cls}`}>
                      <Icon name={s.icon} size={16} />
                      {s.text}
                    </span>
                    {g.needs_you > 0 && (
                      <span className="needs-badge">
                        <Icon name="clock" size={14} />
                        {g.needs_you} need{g.needs_you === 1 ? "s" : ""} your OK
                      </span>
                    )}
                    <span className="tab-card-go" aria-hidden="true"><Icon name="chevron" size={20} /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="pad new-tab" aria-labelledby="new-tab-heading">
        <h2 className="pad-title" id="new-tab-heading">What are you splitting?</h2>
        <p className="pad-sub">Give the tab a name. You'll get an invite link next.</p>
        <form onSubmit={handleCreate} className="pad-form">
          <label className="pad-field">
            <span>Tab name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend in Kumasi" maxLength={80} required />
          </label>
          <fieldset className="pad-field plain-fieldset">
            <legend>Currency</legend>
            <div className="seg" role="radiogroup" aria-label="Currency">
              {Object.values(CURRENCIES).map((c) => (
                <label key={c.code} className={`seg-opt${currency === c.code ? " is-on" : ""}`}>
                  <input type="radio" name="currency" value={c.code} checked={currency === c.code} onChange={() => setCurrency(c.code)} />
                  <span>{c.name} <span className="seg-sym">({c.symbol})</span></span>
                </label>
              ))}
            </div>
            <p className="muted small">Everyone on the tab uses it. It can't be changed once the tab is made.</p>
          </fieldset>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Starting…" : "Start the tab"}
          </button>
        </form>
      </section>
    </div>
  );
}
