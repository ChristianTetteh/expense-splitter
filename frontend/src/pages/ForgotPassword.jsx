import { useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage, post } from "../api";
import { Icon } from "../components/Icons.jsx";
import AuthAside from "../components/AuthAside.jsx";

const FALLBACK = "If that email has an account, a reset link is on its way. It works for 30 minutes.";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await post("/auth/forgot", { email });
      // The same wording for every address: this page never says whether an account exists.
      setSentMessage(res.data?.message || FALLBACK);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page auth-page">
      <AuthAside />
      <div className="pad auth-card">
        <h1 className="pad-title">Forgot your password?</h1>
        <p className="pad-sub">Enter your email and we'll send you a link to choose a new one.</p>

        {/* Always in the page, so screen readers announce what appears inside it. */}
        <div role="status" aria-live="polite">
          {sentMessage && (
            <p className="notice auth-notice">
              <Icon name="check" size={20} />
              <span>{sentMessage} Check your spam folder if it doesn't show up.</span>
            </p>
          )}
        </div>

        {!sentMessage && (
          <form onSubmit={handleSubmit} className="pad-form">
            <label className="pad-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                required
                autoComplete="email"
                autoFocus
              />
            </label>

            <div role="alert">{error && <p className="form-error">{error}</p>}</div>

            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="pad-switch">
          {sentMessage ? "Done here? " : "Remembered it? "}
          <Link to="/login">Back to log in</Link>
        </p>
      </div>
    </div>
  );
}
