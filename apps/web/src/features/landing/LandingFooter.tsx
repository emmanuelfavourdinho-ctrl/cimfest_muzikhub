import { Link, useLocation } from 'react-router';
import { BrandMark } from '@/components/layout/BrandMark';
import { footer } from './content';

/** In-page anchor on the landing page; a router link (then hash-scroll) everywhere else. */
function FooterLink({ to, children }: { to: string; children: string }) {
  const { pathname } = useLocation();
  const className = 'inline-flex min-h-11 items-center text-small text-text-2 transition-colors duration-(--motion-micro) hover:text-text-1';
  if (to.startsWith('/#') && pathname === '/') {
    return (
      <a href={to.slice(1)} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-hairline bg-surface-footer pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto grid max-w-content grid-cols-1 gap-12 px-gutter pt-16 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <BrandMark />
          <p className="mt-4 max-w-xs text-small text-text-2">{footer.mission}</p>
          <p className="mt-2 text-small text-text-3">{footer.tagline}</p>
        </div>
        <nav aria-label="Footer" className="contents">
          {footer.groups.map((g) => (
            <div key={g.label}>
              <h2 className="text-label text-text-2 uppercase">{g.label}</h2>
              <ul className="mt-3">
                {g.links.map((l) => (
                  <li key={l.to}>
                    <FooterLink to={l.to}>{l.label}</FooterLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="mx-auto mt-12 max-w-content px-gutter">
        <p className="border-t border-hairline pt-6 text-small text-text-3">© {new Date().getFullYear()} MuzikHub</p>
      </div>
    </footer>
  );
}
