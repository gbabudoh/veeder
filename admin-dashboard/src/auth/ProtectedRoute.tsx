/**
 * Route guard for administrative views.
 *
 * Wraps protected route elements and gates rendering on the current session.
 * When no session exists, navigation is redirected to `/login` and the
 * originally-requested location is preserved in the navigation state so the
 * login page can return the operator there after a successful admin login
 * (Req 16.1, 16.5). While unauthenticated this prevents any non-login view
 * from rendering (Req 16.2).
 *
 * Designed as a wrapper that renders its `children` when authenticated, e.g.:
 *
 *   <ProtectedRoute>
 *     <AnalyticsPage />
 *   </ProtectedRoute>
 *
 * Requirements: 16.1, 16.2, 16.5
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from './SessionProvider';
import { AppShell } from '../components/AppShell';

/**
 * Render `children` inside the AppShell only when a session is active.
 * Otherwise redirect to /login, preserving the requested location.
 */
export function ProtectedRoute({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const { isAuthenticated } = useSession();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <AppShell>{children}</AppShell>;
}
