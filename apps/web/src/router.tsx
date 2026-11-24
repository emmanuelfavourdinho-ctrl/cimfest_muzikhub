import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { createBrowserRouter, Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Eyebrow, PageLoading } from '@/components/ui/primitives';
import { LandingPage } from '@/features/landing/LandingPage';

/**
 * Route-level code splitting: each page is its own JS chunk, so a phone opening the
 * landing page doesn't download the feed, studio or editor code (CLAUDE.md §21.6).
 * The landing page is the only eager page; the app shell and the auth guards are lazy too,
 * because they bring the validated API client (Zod + schemas) and the auth client.
 */
type Loader<K extends string> = () => Promise<Record<K, ComponentType>>;

/** A lazy page whose download can be started early (and only ever happens once). */
function lazyPage<K extends string>(load: Loader<K>, name: K) {
  let pending: Promise<{ default: ComponentType }> | null = null;
  const preload = () => (pending ??= load().then((m) => ({ default: m[name] })));
  return { Component: lazy<ComponentType>(preload), preload };
}

function page<K extends string>(load: Loader<K>, name: K) {
  const { Component } = lazyPage(load, name);
  return (
    <Suspense fallback={<PageLoading />}>
      <Component />
    </Suspense>
  );
}

/** Starts a page download as soon as its route renders, in parallel with the auth guard and /me. */
function Preload({ run }: { run: () => unknown }) {
  useEffect(() => void run(), [run]);
  return null;
}

const RequireAuth = lazy(() => import('@/features/auth/guards').then((m) => ({ default: m.RequireAuth })));
const RedirectIfSignedIn = lazy(() => import('@/features/auth/guards').then((m) => ({ default: m.RedirectIfSignedIn })));

/**
 * Guarded pages. Without the Preload, a guarded page downloads in sequence (entry → guard chunk →
 * /me → page chunk), which pushed LCP on /login past 3 s on throttled mobile. Now the page chunk
 * loads alongside the guard.
 */
function guarded<K extends string>(Guard: typeof RequireAuth, load: Loader<K>, name: K) {
  const { Component, preload } = lazyPage(load, name);
  return (
    <>
      <Preload run={preload} />
      <Suspense fallback={<PageLoading />}>
        <Guard>
          <Suspense fallback={<PageLoading />}>
            <Component />
          </Suspense>
        </Guard>
      </Suspense>
    </>
  );
}
const auth = <K extends string>(load: Loader<K>, name: K) => guarded(RequireAuth, load, name);
const guest = <K extends string>(load: Loader<K>, name: K) => guarded(RedirectIfSignedIn, load, name);

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: guest(() => import('@/features/auth/LoginPage'), 'LoginPage') },
  { path: '/register', element: guest(() => import('@/features/auth/RegisterPage'), 'RegisterPage') },
  { path: '/forgot-password', element: page(() => import('@/features/auth/PasswordResetPages'), 'ForgotPasswordPage') },
  { path: '/reset-password', element: page(() => import('@/features/auth/PasswordResetPages'), 'ResetPasswordPage') },
  { path: '/email-verified', element: page(() => import('@/features/auth/EmailVerifiedPage'), 'EmailVerifiedPage') },
  // Draft legal and support pages (footer, register form). Marked DRAFT, pending legal review.
  { path: '/terms', element: page(() => import('@/features/legal/LegalPages'), 'TermsPage') },
  { path: '/privacy', element: page(() => import('@/features/legal/LegalPages'), 'PrivacyPage') },
  { path: '/safety', element: page(() => import('@/features/legal/LegalPages'), 'SafetyPage') },
  { path: '/contact', element: page(() => import('@/features/legal/LegalPages'), 'ContactPage') },
  { path: '/onboarding', element: auth(() => import('@/features/onboarding/OnboardingPage'), 'OnboardingPage') },
  // Admin Console: its own layout and navigation, separate from the member app.
  // RequireAuth is UX only; every /api/v1/admin call is authorised on the server.
  {
    path: '/admin',
    element: auth(() => import('@/features/admin/AdminLayout'), 'AdminLayout'),
    children: [
      { index: true, element: page(() => import('@/features/admin/OverviewPage'), 'OverviewPage') },
      { path: 'reports', element: page(() => import('@/features/admin/ReportsPage'), 'ReportsPage') },
      { path: 'reports/:id', element: page(() => import('@/features/admin/ReportDetailPage'), 'ReportDetailPage') },
      { path: 'users', element: page(() => import('@/features/admin/UsersPage'), 'UsersPage') },
      { path: 'users/:id', element: page(() => import('@/features/admin/UserDetailPage'), 'UserDetailPage') },
      { path: 'content', element: page(() => import('@/features/admin/ContentPage'), 'ContentPage') },
      { path: 'pricing', element: page(() => import('@/features/admin/PricingAdminPage'), 'PricingAdminPage') },
      { path: 'payments', element: page(() => import('@/features/admin/PaymentsPage'), 'PaymentsPage') },
      { path: 'payments/:reference', element: page(() => import('@/features/admin/PaymentDetailPage'), 'PaymentDetailPage') },
      { path: 'promotions', element: page(() => import('@/features/admin/PromotionsAdminPage'), 'PromotionsAdminPage') },
      { path: 'audit', element: page(() => import('@/features/admin/AuditPage'), 'AuditPage') },
    ],
  },
  {
    lazy: () => import('@/components/layout/AppShell').then((m) => ({ Component: m.AppShell })),
    hydrateFallbackElement: <PageLoading />,
    children: [
      // Public pages (FR-10, FR-16): anyone can view profiles, work, posts and discovery.
      { path: '/u/:username', element: page(() => import('@/features/profile/ProfilePage'), 'ProfilePage') },
      { path: '/work/:id', element: page(() => import('@/features/portfolio/PortfolioItemPage'), 'PortfolioItemPage') },
      { path: '/p/:id', element: page(() => import('@/features/feed/PostPage'), 'PostPage') },
      { path: '/discover', element: page(() => import('@/features/discover/DiscoverPage'), 'DiscoverPage') },
      { path: '/communities', element: page(() => import('@/features/communities/CommunitiesPage'), 'CommunitiesPage') },
      { path: '/communities/new', element: auth(() => import('@/features/communities/CommunityEditorPage'), 'CommunityEditorPage') },
      { path: '/communities/:slug', element: page(() => import('@/features/communities/CommunityPage'), 'CommunityPage') },
      {
        path: '/communities/:slug/settings',
        element: auth(() => import('@/features/communities/CommunityEditorPage'), 'CommunityEditorPage'),
      },
      { path: '/communities/:slug/members', element: page(() => import('@/features/communities/CommunityPage'), 'CommunityPage') },
      { path: '/communities/:slug/d/:id', element: page(() => import('@/features/communities/DiscussionPage'), 'DiscussionPage') },
      { path: '/pricing', element: page(() => import('@/features/billing/PricingPage'), 'PricingPage') },
      { path: '/billing/checkout', element: auth(() => import('@/features/billing/CheckoutPage'), 'CheckoutPage') },
      { path: '/checkout/return', element: auth(() => import('@/features/billing/CheckoutReturnPage'), 'CheckoutReturnPage') },
      { path: '/billing/orders/:reference', element: auth(() => import('@/features/billing/ReceiptPage'), 'ReceiptPage') },
      { path: '/settings/preferences', element: auth(() => import('@/features/settings/PreferencesPage'), 'PreferencesPage') },
      { path: '/settings/billing', element: auth(() => import('@/features/billing/BillingPage'), 'BillingPage') },
      { path: '/promote', element: auth(() => import('@/features/promotions/PromotePage'), 'PromotePage') },
      { path: '/studio/analytics', element: auth(() => import('@/features/analytics/AnalyticsPage'), 'AnalyticsPage') },
      { path: '/messages', element: auth(() => import('@/features/messages/MessagesPage'), 'MessagesPage') },
      { path: '/messages/:id', element: auth(() => import('@/features/messages/MessagesPage'), 'MessagesPage') },
      { path: '/notifications', element: auth(() => import('@/features/billing/NotificationsPage'), 'NotificationsPage') },
      // Development-only payment sandbox (Phase 3). `import.meta.env.DEV` is false in production
      // builds, so these routes and their chunk are removed at build time. Not in any navigation.
      ...(import.meta.env.DEV
        ? [
            { path: '/dev/payments', element: auth(() => import('@/features/dev/SandboxPaymentsPage'), 'SandboxPaymentsPage') },
            { path: '/dev/payments/checkout', element: auth(() => import('@/features/dev/SandboxPaymentsPage'), 'FakeCheckoutPage') },
          ]
        : []),
      { path: '/opportunities', element: page(() => import('@/features/opportunities/OpportunitiesPage'), 'OpportunitiesPage') },
      {
        path: '/opportunities/new',
        element: auth(() => import('@/features/opportunities/OpportunityEditorPage'), 'OpportunityEditorPage'),
      },
      { path: '/opportunities/:id', element: page(() => import('@/features/opportunities/OpportunityPage'), 'OpportunityPage') },
      {
        path: '/opportunities/:id/edit',
        element: auth(() => import('@/features/opportunities/OpportunityEditorPage'), 'OpportunityEditorPage'),
      },
      // Signed-in pages
      { path: '/home', element: auth(() => import('@/features/home/HomePage'), 'HomePage') },
      { path: '/studio', element: auth(() => import('@/features/portfolio/StudioPage'), 'StudioPage') },
      { path: '/studio/new', element: auth(() => import('@/features/portfolio/PortfolioEditorPage'), 'PortfolioEditorPage') },
      { path: '/studio/:id/edit', element: auth(() => import('@/features/portfolio/PortfolioEditorPage'), 'PortfolioEditorPage') },
      { path: '/network', element: auth(() => import('@/features/network/NetworkPage'), 'NetworkPage') },
      { path: '/settings/profile', element: auth(() => import('@/features/profile/EditProfilePage'), 'EditProfilePage') },
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
