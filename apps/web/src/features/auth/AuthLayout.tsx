import type { ReactNode } from 'react';
import { BrandMark } from '@/components/layout/BrandMark';
import { Eyebrow } from '@/components/ui/primitives';

/** Split layout: brand statement (desktop) + form panel. Mobile shows the form only. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-[59px] items-center border-b border-[#214639] px-4 sm:h-[66px] sm:px-8">
        <BrandMark />
      </header>
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-8 sm:px-8 lg:grid-cols-[1fr_minmax(0,460px)]">
        <section className="hidden lg:block">
          <Eyebrow>Music is better together</Eyebrow>
          <h1 className="mt-3 max-w-xl text-[43px] leading-[1.065] font-extrabold tracking-[-0.045em]">
            Discover talent.
            <br />
            Create together.
            <br />
            <em className="text-[#41eca5] not-italic">Grow together.</em>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[#c4dfd1]">
            One connected world for artists, producers, DJs, engineers and the people who move music forward.
          </p>
        </section>
        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}
