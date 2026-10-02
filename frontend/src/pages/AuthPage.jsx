import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { safeNext, useAuth } from "../auth";
import { errorMessage } from "../api";
import { Icon, TallyMark } from "../components/Icons.jsx";

export default function AuthPage({ mode }) {
  const isSignup = mode === "signup";
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (isSignup && password.length < 10) {
      setError("Use a password of at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      if (isSignup) await signup({ email, display_name: displayName, password });
      else await login(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const otherLink = `${isSignup ? "/login" : "/signup"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="page auth-page">
      <aside className="auth-aside" aria-hidden="true">
        <TallyMark size={56} />
        <p className="auth-aside-title">A tab everyone has agreed to.</p>
        <ul className="auth-aside-points">
          <li><Icon name="check" size={18} /> A charge only counts once that person accepts it.</li>
          <li><Icon name="check" size={18} /> A payment only counts once the receiver confirms it.</li>
          <li><Icon name="check" size={18} /> Nothing is deleted; it all stays in the history.</li>
        </ul>
      </aside>
      <div className="pad auth-card">
        <h1 className="pad-title">{isSignup ? "Make an account" : "Log in to Tally"}</h1>
        <p className="pad-sub">
          {isSignup
            ? "Your tabs are private: only people you let in can see them, and nobody can log a payment in your name."
            : "See your tabs and who owes whom."}
        </p>

        <form onSubmit={handleSubmit} className="pad-form">
          {isSignup && (
            <label className="pad-field">
              <span>Your name (what friends will see)</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} required autoComplete="name" />
            </label>
          )}
          <label className="pad-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required autoComplete="email" />
          </label>
          <label className="pad-field">
            <span>Password{isSignup ? " (10+ characters)" : ""}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={200}
              required
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "One moment…" : isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="pad-switch">
          {isSignup ? "Already have an account? " : "New to Tally? "}
          <Link to={otherLink}>{isSignup ? "Log in" : "Make an account"}</Link>
        </p>
      </div>
    </div>
  );
}
