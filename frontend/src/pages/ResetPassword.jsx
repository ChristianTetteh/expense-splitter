import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { errorMessage, post } from "../api";
import { Icon } from "../components/Icons.jsx";
import AuthAside from "../components/AuthAside.jsx";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const INVALID = "This reset link is invalid or has expired.";

// The reset token travels in the URL fragment, which the browser never sends
// to any server. Read it once into memory (a pure read, so React may call
// this twice) and strip it from the address bar and history in an effect.
function readTokenFromHash() {
  const raw = window.location.hash.replace(/^#/, "");
  return TOKEN_RE.test(raw) ? raw : "";
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const { forgetUser } = useAuth();
  const [token, setToken] = useState(readTokenFromHash);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 10) return setError("Use a password of at least 10 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      await post("/auth/reset", { token, password });
      setToken("");
      forgetUser(); // every session was just revoked on the server
      navigate("/login", { replace: true, state: { notice: "Password changed. Log in with your new password." } });
    } catch (err) {
      if (err.response?.data?.code === "invalid_token") setToken(""); // shows the "request a new link" state
      else setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="page auth-page">
      <AuthAside />
      <div className="pad auth-card">
        {token ? (
          <>
            <h1 className="pad-title">Choose a new password</h1>
            <p className="pad-sub">You'll be logged out of Tally everywhere, then you can log in with the new one.</p>

            <form onSubmit={handleSubmit} className="pad-form">
              <label className="pad-field">
                <span>New password (10+ characters)</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={200}
                  required
                  autoComplete="new-password"
                  autoFocus
                />
              </label>
              <label className="pad-field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  maxLength={200}
                  required
                  autoComplete="new-password"
                />
              </label>

              <div role="alert">{error && <p className="form-error">{error}</p>}</div>

              <button className="btn-primary" type="submit" disabled={busy}>
                {busy ? "One moment…" : "Change password"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="pad-title">This link won't work</h1>
            <p className="error-banner" role="alert">
              <Icon name="alert" size={20} />
              <span>{INVALID} Links work once, for 30 minutes.</span>
            </p>
            <Link className="btn-primary btn-link" to="/forgot">Request a new link</Link>
          </>
        )}

        <p className="pad-switch">
          <Link to="/login">Back to log in</Link>
        </p>
      </div>
    </div>
  );
}
