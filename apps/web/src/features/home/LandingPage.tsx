import { Link, Navigate } from 'react-router';
import { ArrowRight, Mic, Search, Users } from 'lucide-react';
import { HeroBackdrop } from '@/components/landing/HeroBackdrop';
import { BrandMark } from '@/components/layout/BrandMark';
import { Button } from '@/components/ui/button';
import { Eyebrow, PageLoading, Panel } from '@/components/ui/primitives';
import { useMe } from '@/lib/queries';

/** Public entry page. Signed-in users go straight to their home. */
export function LandingPage() {
  const { data: me, isPending } = useMe();
  if (isPending) return <PageLoading />;
  if (me) return <Navigate to={me.profile.onboardingCompletedAt ? '/home' : '/onboarding'} replace />;

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-30 flex h-[59px] items-center justify-between border-b border-[#214639] bg-[rgba(5,20,16,.94)] px-4 backdrop-blur-lg sm:h-[66px] sm:px-8">
        <BrandMark />
        <Button asChild variant="quiet" size="sm">
          <Link to="/login">Sign in</Link>
        </Button>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
        {/* Prototype hero, now with the approved photo sequence behind a stable headline + CTA. */}
        <section className="relative flex min-h-[560px] items-end overflow-hidden rounded-[23px] border border-[#2c7055] md:min-h-[600px] md:items-center">
          <HeroBackdrop />
          <div className="relative z-10 px-6 py-10 sm:px-10">
            <Eyebrow>Music is better together</Eyebrow>
            <h1 className="mt-3 max-w-[680px] text-[33px] leading-[1.065] font-extrabold tracking-[-0.045em] sm:text-[43px]">
              Discover talent.
              <br />
              Create together.
              <br />
              <em className="text-[#41eca5] not-italic">Grow together.</em>
            </h1>
            <p className="mt-4 mb-6 max-w-md text-sm leading-relaxed text-[#c4dfd1]">
              One connected world for artists, producers, DJs, engineers and the people who move music forward.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/register">
                  Join MuzikHub <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            { icon: Mic, title: 'Build your professional identity', text: 'One profile for every role you play — artist, producer, engineer, DJ — with links to where your music lives.' },
            { icon: Search, title: 'Get discovered', text: 'Showcase your work so artists, scouts and organisers can find the talent they are looking for.' },
            { icon: Users, title: 'Connect and collaborate', text: 'Meet collaborators, join communities and find opportunities in one music-focused place.' },
          ].map(({ icon: Icon, title, text }) => (
            <Panel key={title} className="p-5">
              <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[#134130] text-mint">
                <Icon className="size-5" />
              </span>
              <h2 className="font-bold">{title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-sage">{text}</p>
            </Panel>
          ))}
        </div>
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-sage-dim sm:px-8">
        <BrandMark /> <p className="mt-2">A music-industry ecosystem · CIMFEST 2026</p>
      </footer>
    </div>
  );
}
