import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Link } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Eyebrow, PageLoading } from '@/components/ui/primitives';
import { RedirectIfSignedIn, RequireAuth } from '@/features/auth/guards';
import { LandingPage } from '@/features/home/LandingPage';

/**
 * Route-level code splitting: each page is its own JS chunk, so a phone opening the
 * landing page doesn't download the feed, studio or editor code (CLAUDE.md §21.6).
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  const Component = lazy<ComponentType>(() => load().then((m) => ({ default: m[name] })));
  return (
    <Suspense fallback={<PageLoading />}>
      <Component />
    </Suspense>
  );
}
const auth = (node: ReactNode) => <RequireAuth>{node}</RequireAuth>;

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <RedirectIfSignedIn>{page(() => import('@/features/auth/LoginPage'), 'LoginPage')}</RedirectIfSignedIn> },
  { path: '/register', element: <RedirectIfSignedIn>{page(() => import('@/features/auth/RegisterPage'), 'RegisterPage')}</RedirectIfSignedIn> },
  { path: '/forgot-password', element: page(() => import('@/features/auth/PasswordResetPages'), 'ForgotPasswordPage') },
  { path: '/reset-password', element: page(() => import('@/features/auth/PasswordResetPages'), 'ResetPasswordPage') },
  { path: '/email-verified', element: page(() => import('@/features/auth/EmailVerifiedPage'), 'EmailVerifiedPage') },
  { path: '/onboarding', element: auth(page(() => import('@/features/onboarding/OnboardingPage'), 'OnboardingPage')) },
  // Admin Console: its own layout and navigation, separate from the member app.
  // RequireAuth is UX only; every /api/v1/admin call is authorised on the server.
  {
    path: '/admin',
    element: auth(page(() => import('@/features/admin/AdminLayout'), 'AdminLayout')),
    children: [
      { index: true, element: page(() => import('@/features/admin/OverviewPage'), 'OverviewPage') },
      { path: 'reports', element: page(() => import('@/features/admin/ReportsPage'), 'ReportsPage') },
      { path: 'reports/:id', element: page(() => import('@/features/admin/ReportDetailPage'), 'ReportDetailPage') },
      { path: 'users', element: page(() => import('@/features/admin/UsersPage'), 'UsersPage') },
      { path: 'users/:id', element: page(() => import('@/features/admin/UserDetailPage'), 'UserDetailPage') },
      { path: 'content', element: page(() => import('@/features/admin/ContentPage'), 'ContentPage') },
      { path: 'audit', element: page(() => import('@/features/admin/AuditPage'), 'AuditPage') },
    ],
  },
  {
    element: <AppShell />,
    children: [
      // Public pages (FR-10, FR-16): anyone can view profiles, work, posts and discovery.
      { path: '/u/:username', element: page(() => import('@/features/profile/ProfilePage'), 'ProfilePage') },
      { path: '/work/:id', element: page(() => import('@/features/portfolio/PortfolioItemPage'), 'PortfolioItemPage') },
      { path: '/p/:id', element: page(() => import('@/features/feed/PostPage'), 'PostPage') },
      { path: '/discover', element: page(() => import('@/features/discover/DiscoverPage'), 'DiscoverPage') },
      // Signed-in pages
      { path: '/home', element: auth(page(() => import('@/features/home/HomePage'), 'HomePage')) },
      { path: '/studio', element: auth(page(() => import('@/features/portfolio/StudioPage'), 'StudioPage')) },
      { path: '/studio/new', element: auth(page(() => import('@/features/portfolio/PortfolioEditorPage'), 'PortfolioEditorPage')) },
      { path: '/studio/:id/edit', element: auth(page(() => import('@/features/portfolio/PortfolioEditorPage'), 'PortfolioEditorPage')) },
      { path: '/network', element: auth(page(() => import('@/features/network/NetworkPage'), 'NetworkPage')) },
      { path: '/settings/profile', element: auth(page(() => import('@/features/profile/EditProfilePage'), 'EditProfilePage')) },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Eyebrow className="justify-center">404</Eyebrow>
      <h1 className="mt-3 text-2xl font-bold">This page doesn't exist</h1>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/">Go to MuzikHub</Link>
      </Button>
    </div>
  );
}
