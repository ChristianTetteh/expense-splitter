import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import api, { post, setUnauthorizedHandler } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking

  useEffect(() => {
    api
      .get("/auth/me")
      .then((res) => setUser(res.data.user))
      .catch(() => setUser(null));
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await post("/auth/login", { email, password });
    setUser(res.data.user);
  }, []);

  const signup = useCallback(async (fields) => {
    const res = await post("/auth/signup", fields);
    setUser(res.data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await post("/auth/logout");
    } finally {
      setUser(null);
    }
  }, []);

  // Drops the logged-in user from memory without a server call — used after a
  // password reset, which revokes every session on the server.
  const forgetUser = useCallback(() => setUser(null), []);

  return <AuthContext.Provider value={{ user, login, signup, logout, forgetUser }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

// Only ever send people back to a path on THIS site. Rejects absolute URLs,
// protocol-relative "//evil.com", and backslash tricks like "/\evil.com"
// that some browsers treat as another host.
export function safeNext(next) {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.includes("\\") || /[\u0000-\u001F]/.test(next)) return "/";
  return next;
}

export function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}
