import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';

export default function Topbar() {
  const { user, logout } = useAuth();
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Social - Screen">
        <span>Social</span>
        <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#38d6c4" />
              <stop offset="1" stopColor="#fbbf24" />
            </linearGradient>
          </defs>
          <path d="M8 5v14l11-7z" fill="url(#brandGrad)" />
        </svg>
        <span className="brand-screen">Screen</span>
      </Link>
      <nav className="topnav">
        <NavLink to="/" end>My rooms</NavLink>
        <NavLink to="/public">Public rooms</NavLink>
        <NavLink to="/stats">My stats</NavLink>
      </nav>
      <div className="topbar-right">
        <span className="muted hide-sm">{user?.name}</span>
        <ThemeToggle />
        <button type="button" className="btn btn-small" onClick={logout}>Log out</button>
      </div>
    </header>
  );
}
