import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { ArrowRight, Check, Disc3, Flag, KeyRound, Link2, Plus, ScrollText, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/primitives';
import { audiences, capabilities, faq, finalCta, problem, roadmap, sample, steps, trust, value } from './content';
import {
  ArtTile,
  ConnectFragment,
  Dial,
  DiscoverFragment,
  FeedFragment,
  Preview,
  PreviewTag,
  ProfileCardPreview,
  RoleChipsPreview,
  SearchFragment,
  UploadFragment,
} from './previews';

function SectionHead({ eyebrow, title, id, intro, tone = 'dark' }: { eyebrow: string; title: string; id: string; intro?: string; tone?: 'dark' | 'paper' }) {
  return (
    <div data-reveal className="max-w-2xl">
      <Eyebrow className={tone === 'paper' ? 'text-on-paper-2 before:bg-on-paper' : undefined}>{eyebrow}</Eyebrow>
      <h2 id={id} className={cn('mt-4 text-h2', tone === 'paper' ? 'text-on-paper' : 'text-text-1')}>
        {title}
      </h2>
      {intro && <p className="mt-4 text-lead text-text-2">{intro}</p>}
    </div>
  );
}

/* ── C. Problem: the one light "paper" section ── */
export function ProblemSection() {
  return (
    <section aria-labelledby="problem-title" className="bg-paper py-section text-on-paper">
      <div className="mx-auto grid max-w-content grid-cols-1 gap-12 px-gutter lg:grid-cols-12">
        <div className="lg:col-span-5" data-reveal>
          <Eyebrow className="text-on-paper-2 before:bg-on-paper">{problem.eyebrow}</Eyebrow>
          <h2 id="problem-title" className="mt-4 text-h1">
            {problem.statement}
          </h2>
        </div>
        <ol className="lg:col-span-7">
          {problem.situations.map((s, i) => (
            <li key={s.title} data-reveal className="grid grid-cols-[3rem_minmax(0,1fr)] gap-4 border-t border-paper-line py-6 last:border-b">
              <span className="text-h3 font-extrabold text-on-paper-2 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3 className="text-h3">{s.title}</h3>
                <p className="mt-2 text-body text-on-paper-2">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── D. Value: sticky heading, scrolling points ── */
const VALUE_ICONS = [Users, Disc3, Link2] as const;
export function ValueSection() {
  return (
    <section aria-labelledby="value-title" className="py-section">
      <div className="mx-auto grid max-w-content grid-cols-1 gap-12 px-gutter lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-hero-top">
            <SectionHead eyebrow={value.eyebrow} title={value.heading} id="value-title" />
          </div>
        </div>
        <ul className="divide-y divide-hairline lg:col-span-7">
          {value.points.map((p, i) => {
            const Icon = VALUE_ICONS[i] ?? Users;
            return (
              <li key={p.title} data-reveal className="flex gap-5 py-8 first:pt-0">
                <Icon className="mt-1 size-6 shrink-0 text-signal" />
                <div>
                  <h3 className="text-h3 text-text-1">{p.title}</h3>
                  <p className="mt-3 max-w-measure text-body text-text-2">{p.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ── E. Who it's for: WAI-ARIA tabs ── */
export function AudienceSection() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const select = (i: number) => {
    const n = (i + audiences.length) % audiences.length;
    setSelected(n);
    tabs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: selected + 1, ArrowLeft: selected - 1, Home: 0, End: audiences.length - 1 };
    if (e.key in map) {
      e.preventDefault();
      select(map[e.key]!);
    }
  };
  const a = audiences[selected]!;

  return (
    <section id="who-its-for" aria-labelledby="audience-title" className="bg-surface-raised py-section">
      <div className="mx-auto max-w-content px-gutter">
        <SectionHead eyebrow="Who it's for" title="Made for everyone who moves music" id="audience-title" />
        <div role="tablist" aria-label="Who MuzikHub is for" onKeyDown={onKey} className="-mx-gutter mt-10 flex gap-2 overflow-x-auto px-gutter pb-2 [scrollbar-width:none]">
          {audiences.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              id={`${base}-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={i === selected}
              aria-controls={`${base}-panel`}
              tabIndex={i === selected ? 0 : -1}
              onClick={() => setSelected(i)}
              className={cn(
                'inline-flex h-11 shrink-0 items-center rounded-full px-5 text-small font-semibold transition-colors duration-(--motion-micro)',
                i === selected ? 'bg-signal text-on-signal' : 'bg-surface-chip text-text-1 hover:bg-surface-control',
              )}
            >
              {t.tab}
            </button>
          ))}
        </div>
        <div
          id={`${base}-panel`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${a.id}`}
          tabIndex={0}
          className="mt-8 grid gap-10 border-t border-hairline pt-10 md:grid-cols-2 md:items-center"
        >
          <div>
            <p className="max-w-measure text-lead text-text-1">{a.summary}</p>
            <h3 className="mt-8 text-label text-text-2 uppercase">What you can do today</h3>
            <ul className="mt-4 space-y-3">
              {a.today.map((t) => (
                <li key={t} className="flex gap-3 text-body text-text-2">
                  <Check className="mt-1 size-4 shrink-0 text-signal" /> {t}
                </li>
              ))}
            </ul>
            <Link to="/register" className="mt-8 inline-flex min-h-11 items-center gap-2 font-bold text-signal underline-offset-4 hover:underline">
              {a.joinLabel} <ArrowRight className="size-4" />
            </Link>
          </div>
          <Preview label={`Illustrative profile preview for ${a.tab.toLowerCase()}. The name is fictional.`} className="mx-auto w-full max-w-sm">
            <ProfileCardPreview person={{ ...sample.creator, roles: [a.tab.replace(/s$/, ''), ...sample.creator.roles.slice(1)] }} />
            <div className="mt-3 flex justify-center">
              <PreviewTag>Illustrative preview</PreviewTag>
            </div>
          </Preview>
        </div>
      </div>
    </section>
  );
}

/* ── F. How it works: timeline that draws in ── */
const STEP_FRAGMENTS = {
  roles: <RoleChipsPreview active="Producer" />,
  upload: <UploadFragment />,
  search: <SearchFragment />,
  connect: <ConnectFragment />,
};
export function StepsSection() {
  return (
    <section id="how-it-works" aria-labelledby="steps-title" className="py-section">
      <div className="mx-auto max-w-content px-gutter">
        <SectionHead eyebrow={steps.eyebrow} title={steps.heading} id="steps-title" />
        <ol data-reveal className="relative mt-14 grid grid-cols-1 gap-12 lg:grid-cols-4 lg:gap-8">
          <span aria-hidden data-line="x" className="absolute top-5 right-0 left-0 hidden h-px origin-left bg-signal lg:block" />
          <span aria-hidden data-line="y" className="absolute top-0 bottom-0 left-5 w-px origin-top bg-signal lg:hidden" />
          {steps.items.map((s, i) => (
            <li key={s.title} className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-5 lg:block">
              <span className="relative z-10 flex size-10 items-center justify-center rounded-full border border-signal bg-surface-base text-small font-extrabold text-signal tabular-nums">
                {i + 1}
              </span>
              <div className="lg:mt-6">
                <h3 className="text-h3 text-text-1">{s.title}</h3>
                <p className="mt-2 text-body text-text-2">{s.text}</p>
                <Preview label={`Illustrative example: ${s.title.toLowerCase()}`} className="mt-5">
                  {STEP_FRAGMENTS[s.fragment]}
                </Preview>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── G. Features: asymmetric bento, each module treated differently ── */
function Module({ title, text, children, className }: { title: string; text: string; children: ReactNode; className?: string }) {
  return (
    <article data-reveal className={cn('flex min-w-0 flex-col gap-6 p-6 sm:p-8', className)}>
      <div>
        <h3 className="text-h3 text-text-1">{title}</h3>
        <p className="mt-2 max-w-measure text-body text-text-2">{text}</p>
      </div>
      <div className="mt-auto">{children}</div>
    </article>
  );
}
export function CapabilitiesSection() {
  const m = capabilities.modules;
  return (
    <section id="features" aria-labelledby="features-title" className="py-section">
      <div className="mx-auto max-w-content px-gutter">
        <SectionHead eyebrow={capabilities.eyebrow} title={capabilities.heading} id="features-title" />
        <div className="mt-12 grid grid-cols-1 border-t border-hairline lg:grid-cols-12">
          <Module title={m.profile.title} text={m.profile.text} className="border-b border-hairline bg-surface-raised lg:col-span-7 lg:border-r">
            <Preview label="Illustrative profile with portfolio artwork. The name is fictional." className="max-w-md">
              <ProfileCardPreview />
            </Preview>
          </Module>
          <Module title={m.player.title} text={m.player.text} className="border-b border-hairline lg:col-span-5">
            <Preview label="Illustrative player with a circular progress dial." className="flex flex-col items-center gap-4 rounded-media bg-surface-overlay py-10">
              <Dial size="lg" />
              <div className="text-center">
                <p className="text-body font-bold text-text-1">{sample.track.title}</p>
                <p className="text-small text-text-2">{sample.creator.name}</p>
              </div>
            </Preview>
          </Module>
          <Module title={m.discover.title} text={m.discover.text} className="border-b border-hairline lg:col-span-5 lg:border-r">
            <Preview label="Illustrative Discover results filtered by role. Names are fictional.">
              <DiscoverFragment />
            </Preview>
          </Module>
          <Module title={m.network.title} text={m.network.text} className="border-b border-hairline bg-surface-raised lg:col-span-7">
            <Preview label="Illustrative feed post and connection request. Names are fictional." className="grid gap-3 sm:grid-cols-2">
              <FeedFragment />
              <div className="space-y-3">
                <ConnectFragment />
                <div className="grid grid-cols-2 gap-3">
                  <ArtTile variant={1} className="aspect-4/3" />
                  <ArtTile variant={2} className="aspect-4/3" />
                </div>
              </div>
            </Preview>
          </Module>
        </div>
        <p className="mt-4 text-small text-text-3">Previews are illustrative; names and tracks are fictional.</p>
      </div>
    </section>
  );
}

/* ── H. Trust: open two-column principles ── */
const TRUST_ICONS = [Link2, KeyRound, Flag, ScrollText] as const;
export function TrustSection() {
  return (
    <section id="trust" aria-labelledby="trust-title" className="bg-surface-raised py-section">
      <div className="mx-auto max-w-content px-gutter">
        <SectionHead eyebrow={trust.eyebrow} title={trust.heading} id="trust-title" />
        <ul className="mt-12 grid gap-x-12 md:grid-cols-2">
          {trust.principles.map((p, i) => {
            const Icon = TRUST_ICONS[i] ?? ShieldCheck;
            return (
              <li key={p.title} data-reveal className="flex gap-4 border-t border-hairline py-7">
                <Icon className="mt-1 size-5 shrink-0 text-signal" />
                <div>
                  <h3 className="text-h3 text-text-1">{p.title}</h3>
                  <p className="mt-2 text-body text-text-2">{p.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-6 text-small text-text-3">
          {trust.later}{' '}
          <a href="#roadmap" className="text-text-2 underline underline-offset-4 hover:text-text-1">
            See the roadmap
          </a>
          .
        </p>
      </div>
    </section>
  );
}

/* ── I. Roadmap: quiet, labelled, no buttons ── */
export function RoadmapSection() {
  return (
    <section id="roadmap" aria-labelledby="roadmap-title" className="py-section">
      <div className="mx-auto max-w-content px-gutter">
        <SectionHead eyebrow={roadmap.eyebrow} title={roadmap.heading} id="roadmap-title" intro={roadmap.intro} />
        <ul className="mt-10 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {roadmap.items.map((r) => (
            <li key={r.title} data-reveal className="border-t border-hairline py-6">
              <span className="inline-flex rounded-full border border-hairline-strong px-2.5 py-0.5 text-caption font-semibold text-text-2">Coming soon</span>
              <h3 className="mt-3 text-body font-bold text-text-1">{r.title}</h3>
              <p className="mt-1 text-small text-text-2">{r.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── J. FAQ: accordion (buttons with aria-expanded / aria-controls) ── */
export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();
  return (
    <section id="faq" aria-labelledby="faq-title" className="bg-surface-raised py-section">
      <div className="mx-auto grid max-w-content grid-cols-1 gap-10 px-gutter lg:grid-cols-12">
        <div className="lg:col-span-4">
          <SectionHead eyebrow={faq.eyebrow} title={faq.heading} id="faq-title" />
        </div>
        <div className="divide-y divide-hairline border-y border-hairline lg:col-span-8">
          {faq.items.map((item, i) => {
            const expanded = open === i;
            return (
              <div key={item.q}>
                <h3>
                  <button
                    type="button"
                    id={`${base}-q-${i}`}
                    aria-expanded={expanded}
                    aria-controls={`${base}-a-${i}`}
                    onClick={() => setOpen(expanded ? null : i)}
                    className="flex min-h-16 w-full items-center justify-between gap-4 py-4 text-left text-h3 text-text-1"
                  >
                    {item.q}
                    <Plus className={cn('size-5 shrink-0 text-signal transition-transform duration-(--motion-standard)', expanded && 'rotate-45')} />
                  </button>
                </h3>
                <div id={`${base}-a-${i}`} role="region" aria-labelledby={`${base}-q-${i}`} hidden={!expanded} className="pb-6">
                  <p className="max-w-measure text-body text-text-2">{item.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── K. Final call to action: the one large lime area ── */
export function FinalCta({ appPath }: { appPath: string | null }) {
  return (
    <section aria-labelledby="cta-title" className="bg-signal py-section text-on-signal [&_*:focus-visible]:outline-on-signal">
      <div className="mx-auto flex max-w-content flex-col items-start gap-8 px-gutter md:flex-row md:items-end md:justify-between">
        <h2 id="cta-title" className="text-h1">
          <span className="block">{finalCta.headline[0]}</span>
          <span className="block">{finalCta.headline[1]}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <Button asChild variant="inverse" size="lg" shape="pill" className="h-13 px-7 text-body">
            <Link to={appPath ?? '/register'}>
              {appPath ? 'Open app' : finalCta.primary} <ArrowRight />
            </Link>
          </Button>
          {!appPath && (
            <Link to="/login" className="inline-flex min-h-11 items-center font-bold underline underline-offset-4">
              {finalCta.secondary}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
