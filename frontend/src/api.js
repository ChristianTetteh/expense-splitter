import axios from "axios";

// Always same-origin: in production Vercel proxies /api to the backend, and
// in development Vite does. That keeps the session cookie first-party and
// means the API never has to allow cross-origin requests.
const api = axios.create({ baseURL: "/api", timeout: 70_000 });

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || "";
    if (err.response?.status === 401 && !url.startsWith("/auth/")) onUnauthorized();
    return Promise.reject(err);
  }
);

// Every write is sent as JSON (even with no fields) — the API refuses
// anything else as a cross-site-request-forgery defence.
export const post = (url, data = {}) => api.post(url, data);

export function errorMessage(err, fallback = "Something went wrong. Try again.") {
  if (!err.response) return "Couldn't reach the server. If it's been idle it can take up to a minute to wake — try again.";
  return err.response.data?.error || fallback;
}

export default api;
