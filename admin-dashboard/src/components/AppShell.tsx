import { type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/SessionProvider';

const NAV_ITEMS = [
  { to: '/overview',  icon: '⊞', label: 'Overview'  },
  { to: '/analytics', icon: '📊', label: 'Analytics' },
  { to: '/users',     icon: '👥', label: 'Users'     },
  { to: '/activity',  icon: '📋', label: 'Activity'  },
];

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { logout } = useSession();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar__logo">
          <div className="sidebar__logo-mark">V</div>
          <div>
            <div className="sidebar__logo-text">Veeder</div>
            <div className="sidebar__logo-sub">Admin Console</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="sidebar__nav">
          <div className="sidebar__section-label">Main</div>
          {NAV_ITEMS.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                'sidebar__link' + (isActive ? ' active' : '')
              }
            >
              <span className="sidebar__link-icon">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar__footer">
          <div className="sidebar__user">
            <div className="sidebar__avatar">A</div>
            <div>
              <div className="sidebar__user-name">Admin</div>
              <div className="sidebar__user-role">Administrator</div>
            </div>
          </div>
          <button type="button" className="sidebar__logout" onClick={handleLogout}>
            ↩ Sign out
          </button>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
