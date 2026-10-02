import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { errorMessage, post } from "../api";
import { Icon, Initial } from "../components/Icons.jsx";

export default function Join() {
  const { token } = useParams();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/invites/${encodeURIComponent(token)}`)
      .then((res) => setInvite(res.data.invite))
      .catch((err) => setError(errorMessage(err, "This invite link isn't valid.")));
  }, [token]);

  async function handleRequest() {
    setBusy(true);
    setError("");
    try {
      const res = await post(`/invites/${encodeURIComponent(token)}/request`);
      setInvite(res.data.invite);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !invite)
    return (
      <div className="page">
        <p className="error-banner" role="alert">
          <Icon name="alert" size={20} />
          <span>{error}</span>
        </p>
        <p className="center"><Link className="btn-ghost btn-link" to="/">Back to your tabs</Link></p>
      </div>
    );
  if (!invite)
    return (
      <div className="page">
        <div className="skeleton-list" role="status" aria-live="polite">
          <span className="sr-only">Loading the invitation…</span>
          <div className="skeleton skeleton-card tall" />
        </div>
      </div>
    );

  return (
    <div className="page">
      <div className="pad pad-narrow invite-card">
        <Initial name={invite.group_name} className="avatar-lg" />
        <p className="pad-eyebrow">You're invited to a tab</p>
        <h1 className="pad-title">{invite.group_name}</h1>
        <p className="pad-sub">
          Started by {invite.owner_name}, with {invite.member_count} {invite.member_count === 1 ? "person" : "people"} so far.
        </p>

        {invite.status === "member" ? (
          <Link className="btn-primary btn-link" to={`/tabs/${invite.group_id}`}>
            Open the tab
          </Link>
        ) : invite.status === "requested" ? (
          <p className="notice">
            <Icon name="clock" size={20} />
            <span>Request sent. {invite.owner_name} needs to approve you before you can see the tab — check back once they have.</span>
          </p>
        ) : (
          <>
            <p className="muted small">
              <Icon name="lock" size={14} /> {invite.owner_name} will see your name and email and decide whether to let you in.
            </p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn-primary" type="button" onClick={handleRequest} disabled={busy}>
              {busy ? "Sending…" : "Ask to join"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
