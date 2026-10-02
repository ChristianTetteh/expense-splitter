import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="site-header">
      <Link to="/" className="brand">
        Tally
      </Link>
      <span className="brand-tagline">split the bill, not the friendship</span>
      {user && (
        <span className="header-user">
          <span className="header-user-name">{user.display_name}</span>
          <button type="button" className="link-btn" onClick={handleLogout}>
            Log out
          </button>
        </span>
      )}
    </header>
  );
}
