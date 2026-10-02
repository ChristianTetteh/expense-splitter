import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { TallyMark } from "./Icons.jsx";

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="brand" aria-label="Tally, your tabs">
          <TallyMark size={26} />
          <span>Tally</span>
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
      </div>
    </header>
  );
}
