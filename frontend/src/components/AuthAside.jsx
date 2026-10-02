import { Icon, TallyMark } from "./Icons.jsx";

// The dark side panel shown next to the sign-in style forms on wide screens.
export default function AuthAside() {
  return (
    <aside className="auth-aside" aria-hidden="true">
      <TallyMark size={56} />
      <p className="auth-aside-title">A tab everyone has agreed to.</p>
      <ul className="auth-aside-points">
        <li><Icon name="check" size={18} /> A charge only counts once that person accepts it.</li>
        <li><Icon name="check" size={18} /> A payment only counts once the receiver confirms it.</li>
        <li><Icon name="check" size={18} /> Nothing is deleted; it all stays in the history.</li>
      </ul>
    </aside>
  );
}
