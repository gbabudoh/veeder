import { useAnalytics } from '../hooks/useAnalytics';
import { useUsers } from '../hooks/useUsers';
import { Chart } from '../components/Chart';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { NavLink } from 'react-router-dom';

function StatCard({
  label, value, sub, accent,
}: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="stat-card">
      {accent && <div className="stat-card__accent" style={{ background: accent }} />}
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
      {sub && <div className="stat-card__sub">{sub}</div>}
    </div>
  );
}

export default function OverviewPage(): JSX.Element {
  const analytics = useAnalytics();
  const users = useUsers({ search: '', page: 1 });

  const isLoading = analytics.isLoading || users.isLoading;
  const isError   = analytics.isError   || users.isError;

  if (isLoading) return <LoadingState label="Loading overview…" />;
  if (isError)   return <ErrorState message="Failed to load overview." onRetry={() => { void analytics.refetch(); void users.refetch(); }} />;

  const d = analytics.data;
  const totalUsers = users.data?.pagination.total ?? 0;

  return (
    <div className="overview-page">
      {/* Header */}
      <div className="overview-header">
        <div>
          <h1>Overview</h1>
          <p>Welcome back — here's what's happening in your app.</p>
        </div>
        <div className="overview-header__badge">Last 30 days</div>
      </div>

      {/* KPI row */}
      <div className="kpi-grid">
        <StatCard label="Total Users"         value={totalUsers}                      accent="#6366f1" />
        <StatCard label="Registrations"       value={d?.registration  ?? 0}           accent="#22c55e" />
        <StatCard label="Login Successes"     value={d?.loginSuccess  ?? 0}           accent="#3b82f6" />
        <StatCard label="Login Failures"      value={d?.loginFailure  ?? 0}           accent="#ef4444" />
        <StatCard label="Active Users"        value={d?.activeUsers   ?? 0}           accent="#f59e0b" />
        <StatCard label="Success Rate"        value={analytics.successRateDisplay}    accent="#8b5cf6" />
      </div>

      {/* Chart + quick links row */}
      <div className="overview-bottom">
        <div className="overview-chart card">
          <div className="card__head">
            <span className="card__title">Activity — Last 30 days</span>
          </div>
          <Chart data={analytics.series} />
        </div>

        <div className="overview-links card">
          <div className="card__head">
            <span className="card__title">Quick access</span>
          </div>
          <div className="quick-links">
            <NavLink to="/users" className="quick-link">
              <span className="quick-link__icon">👥</span>
              <div>
                <div className="quick-link__label">Users</div>
                <div className="quick-link__sub">Browse &amp; search all accounts</div>
              </div>
              <span className="quick-link__arrow">→</span>
            </NavLink>
            <NavLink to="/activity" className="quick-link">
              <span className="quick-link__icon">📋</span>
              <div>
                <div className="quick-link__label">Activity Log</div>
                <div className="quick-link__sub">Login events, registrations</div>
              </div>
              <span className="quick-link__arrow">→</span>
            </NavLink>
            <NavLink to="/analytics" className="quick-link">
              <span className="quick-link__icon">📊</span>
              <div>
                <div className="quick-link__label">Analytics</div>
                <div className="quick-link__sub">Deep-dive metrics &amp; charts</div>
              </div>
              <span className="quick-link__arrow">→</span>
            </NavLink>
          </div>
        </div>
      </div>
    </div>
  );
}
