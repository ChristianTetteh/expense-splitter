import { Link } from "react-router-dom";

export default function Header() {
  return (
    <header className="site-header">
      <Link to="/" className="brand">
        Tally
      </Link>
      <span className="brand-tagline">split the bill, not the friendship</span>
    </header>
  );
}
