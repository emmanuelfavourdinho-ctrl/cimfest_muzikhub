import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { BrandMark } from '@/components/layout/BrandMark';
import { LandingFooter } from '@/features/landing/LandingFooter';

/*
 * DRAFT pages linked from the footer and the register form. They describe only how MuzikHub
 * works today (verifiable in the code). No legal terms, addresses, company details or contact
 * channels are invented: those come from the project owner and legal review.
 */

type Section = { heading: string; body: ReactNode };

function LegalLayout({ title, intro, sections }: { title: string; intro: string; sections: Section[] }) {
  return (
    <div className="min-h-svh bg-surface-base">
      <title>{`${title} (draft) — MuzikHub`}</title>
      <meta name="robots" content="noindex" />
      <header className="header-surface sticky top-0 z-30 border-b border-hairline">
        <div className="mx-auto flex h-(--header-h) max-w-content items-center justify-between px-gutter">
          <BrandMark />
          <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-small font-semibold text-text-2 hover:text-text-1">
            <ArrowLeft className="size-4" /> Back to MuzikHub
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-measure px-gutter py-section">
        <p role="note" className="rounded-m border border-warning/40 bg-warning/10 px-4 py-3 text-small text-text-1">
          <strong className="text-warning">Draft — pending legal review.</strong> This page describes how MuzikHub works today. It is not
          yet a final legal document.
        </p>
        <h1 className="mt-8 text-h1 text-text-1">{title}</h1>
        <p className="mt-4 text-lead text-text-2">{intro}</p>
        {sections.map((s) => (
          <section key={s.heading} className="mt-10">
            <h2 className="text-h3 text-text-1">{s.heading}</h2>
            <div className="mt-3 space-y-3 text-body text-text-2">{s.body}</div>
          </section>
        ))}
      </main>
      <LandingFooter />
    </div>
  );
}

const contactPending = 'A contact address will be published here before launch.';

export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy"
      intro="What MuzikHub stores about you today, and why."
      sections={[
        {
          heading: 'What we store',
          body: (
            <ul className="list-disc space-y-2 pl-5">
              <li>Your account: name, username, email address and a hashed password (never the password itself).</li>
              <li>Your profile: the roles, genres, location, bio, images and links you add.</li>
              <li>Your work and activity: portfolio items, uploaded media, posts, comments, likes, follows and connections.</li>
              <li>Sign-in sessions, so you stay signed in, and reports you make about content.</li>
            </ul>
          ),
        },
        {
          heading: 'Cookies',
          body: (
            <p>
              MuzikHub uses only the cookies needed to keep you signed in. They are HTTP-only, so scripts in the page cannot read them.
              There are no advertising or analytics cookies.
            </p>
          ),
        },
        {
          heading: 'Who can see what',
          body: (
            <p>
              Your profile and published portfolio items are public. Portfolio items you keep private are visible only to you. Your email
              address is not shown on your profile.
            </p>
          ),
        },
        {
          heading: 'Services we use',
          body: (
            <p>
              Uploaded media is stored with our media provider, and account emails (verification and password reset) are sent through our
              email provider.
            </p>
          ),
        },
        {
          heading: 'Your choices',
          body: (
            <p>
              You can edit your profile and delete your own posts and portfolio items at any time. Data export and self-service account
              deletion are on the roadmap. {contactPending}
            </p>
          ),
        },
      ]}
    />
  );
}

export function TermsPage() {
  return (
    <LegalLayout
      title="Terms"
      intro="The terms of use for MuzikHub are being prepared."
      sections={[
        {
          heading: 'Status',
          body: (
            <p>
              Final terms of use will be published here after legal review. Until then, the community expectations on the Safety and trust
              page apply.
            </p>
          ),
        },
        {
          heading: 'Your content',
          body: <p>You choose what you publish. Only upload work you have the right to share.</p>,
        },
        {
          heading: 'Paid services',
          body: <p>MuzikHub has no paid services today. Basic participation — your profile, portfolio, discovery and network — is free.</p>,
        },
      ]}
    />
  );
}

export function SafetyPage() {
  return (
    <LegalLayout
      title="Safety and trust"
      intro="How reporting and moderation work on MuzikHub today."
      sections={[
        {
          heading: 'Reporting',
          body: (
            <p>
              If you are signed in, use “Report” on a post, a piece of work or a profile. Choose a reason and add details if you like.
              Reports go to MuzikHub moderators.
            </p>
          ),
        },
        {
          heading: 'Moderation',
          body: (
            <p>
              Moderators can remove content and restrict or suspend accounts; bans can only be made by administrators. Every action requires
              a reason and is recorded in an audit log that cannot be edited. Staff accounts require two-step verification.
            </p>
          ),
        },
        {
          heading: 'Getting in touch',
          body: <p>{contactPending}</p>,
        },
      ]}
    />
  );
}

export function ContactPage() {
  return (
    <LegalLayout
      title="Contact"
      intro="How to reach the MuzikHub team."
      sections={[
        { heading: 'Email', body: <p>{contactPending}</p> },
        {
          heading: 'Reporting content',
          body: (
            <p>
              To report a post, a piece of work or a profile, use the “Report” option on it while signed in — that reaches our moderators
              directly.
            </p>
          ),
        },
      ]}
    />
  );
}
