import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';

import { ProtectedRoute } from './auth/ProtectedRoute';
import LoginPage       from './pages/LoginPage';
import OverviewPage    from './pages/OverviewPage';
import AnalyticsPage   from './pages/AnalyticsPage';
import UsersListPage   from './pages/UsersListPage';
import UserDetailPage  from './pages/UserDetailPage';
import ActivityLogPage from './pages/ActivityLogPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/overview',
    element: <ProtectedRoute><OverviewPage /></ProtectedRoute>,
  },
  {
    path: '/analytics',
    element: <ProtectedRoute><AnalyticsPage /></ProtectedRoute>,
  },
  {
    path: '/users',
    element: <ProtectedRoute><UsersListPage /></ProtectedRoute>,
  },
  {
    path: '/users/:id',
    element: <ProtectedRoute><UserDetailPage /></ProtectedRoute>,
  },
  {
    path: '/activity',
    element: <ProtectedRoute><ActivityLogPage /></ProtectedRoute>,
  },
  // Default landing → Overview
  { path: '/',  element: <Navigate to="/overview" replace /> },
  { path: '*',  element: <Navigate to="/overview" replace /> },
];

export function createRouter() {
  return createBrowserRouter(routes);
}

export const router = createRouter();
