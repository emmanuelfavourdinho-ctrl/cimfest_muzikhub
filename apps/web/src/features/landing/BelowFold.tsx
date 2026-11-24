import { useEffect } from 'react';
import { LandingFooter } from './LandingFooter';
import { AudienceSection, CapabilitiesSection, FaqSection, FinalCta, ProblemSection, RoadmapSection, StepsSection, TrustSection, ValueSection } from './sections';

/*
 * Everything below the hero, in its own chunk. LandingPage renders it in a transition after the
 * hero has painted, so the first screen isn't blocked by the rest of a long page.
 */

export function BelowFoldMain({ appPath, onReady }: { appPath: string | null; onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return (
    <>
      <ProblemSection />
      <ValueSection />
      <AudienceSection />
      <StepsSection />
      <CapabilitiesSection />
      <TrustSection />
      <RoadmapSection />
      <FaqSection />
      <FinalCta appPath={appPath} />
    </>
  );
}

export { LandingFooter as BelowFoldFooter };
