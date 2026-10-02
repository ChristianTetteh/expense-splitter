import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { errorMessage, post } from "../api";
import { formatCents } from "../utils/money";

function standing(netCents) {
  if (netCents > 0) return { text: `you're owed ${formatCents(netCents)}`, cls: "is-credit" };
  if (netCents < 0) return { text: `you owe ${formatCents(-netCents)}`, cls: "is-debit" };
  return { text: "square", cls: "muted" };
}

export default function Home() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
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
      const res = await post("/groups", { name });
      navigate(`/tabs/${res.data.group.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <section className="tabs-section">
        <h1 className="section-title">Your tabs</h1>
        {loadError && <p className="error-banner">{loadError}</p>}
        {groups === null && !loadError ? (
          <p className="muted">Loading…</p>
        ) : groups && groups.length === 0 ? (
          <p className="muted">No tabs yet. Start one below, then send its invite link to the people you're splitting with.</p>
        ) : (
          <ul className="tab-list">
            {(groups || []).map((g) => {
              const s = standing(g.net_cents);
              return (
                <li key={g.id}>
                  <Link to={`/tabs/${g.id}`} className="tab-card">
                    <span className="tab-card-name">{g.name}</span>
                    <span className="tab-card-meta">
                      {g.member_count} {g.member_count === 1 ? "person" : "people"}
                      {g.is_owner ? " · you started it" : ""}
                    </span>
                    <span className={`tab-card-standing ${s.cls}`}>
                      {s.text}
                      {g.needs_you > 0 && <span className="needs-badge">{g.needs_you} need{g.needs_you === 1 ? "s" : ""} your OK</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="pad">
        <p className="pad-eyebrow">New tab</p>
        <h2 className="pad-title">What are you splitting?</h2>
        <form onSubmit={handleCreate} className="pad-form">
          <label className="pad-field">
            <span>Tab name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend in Kumasi" maxLength={80} required />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Starting…" : "Start the tab"}
          </button>
        </form>
      </div>
    </div>
  );
}
