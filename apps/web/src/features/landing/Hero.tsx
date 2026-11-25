import { Link } from 'react-router';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/primitives';
import { hero } from './content';
import { Preview, PreviewTag, ProfileCardPreview, RoleChipsPreview, TrackRowPreview } from './previews';

export function Hero({ appPath }: { appPath: string | null }) {
  const [l1, l2, l3] = hero.headline;
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden pt-hero-top pb-section">
      <div className="mx-auto grid max-w-content grid-cols-1 items-center gap-12 px-gutter lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-7">
          <Eyebrow>{hero.eyebrow}</Eyebrow>
          <h1 id="hero-title" className="mt-5 text-display text-text-1">
            <span className="block">{l1}</span>
            <span className="block">{l2}</span>
            <span className="block text-signal">{l3}</span>
          </h1>
          <p className="mt-6 max-w-measure text-lead text-text-2">{hero.lead}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" shape="pill" className="h-13 px-7 text-body">
              <Link to={appPath ?? '/register'}>
                {appPath ? 'Open app' : hero.primary} <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" shape="pill" className="h-13 px-7 text-body">
              <a href="#how-it-works">
                {hero.secondary} <ArrowDown />
              </a>
            </Button>
          </div>
        </div>

        <div className="relative lg:col-span-5">
          {/* The page's one glow: a soft radial behind the preview. Solid fallback is simply the page. */}
          <div aria-hidden className="pointer-events-none absolute -inset-16 bg-[radial-gradient(closest-side,var(--p-glow),transparent)]" />
          <figure className="relative mx-auto max-w-sm lg:max-w-md">
            <Preview label={hero.previewAlt} className="relative">
              <div className="space-y-4 lg:space-y-0">
                <div className="lg:mr-12">
                  <ProfileCardPreview />
                </div>
                <div className="lg:-mt-6 lg:ml-12">
                  <TrackRowPreview />
                </div>
                <div className="lg:mt-5 lg:ml-4">
                  <RoleChipsPreview />
                </div>
              </div>
            </Preview>
            <figcaption className="mt-4 flex justify-center lg:justify-start">
              <PreviewTag>{hero.previewLabel}</PreviewTag>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
