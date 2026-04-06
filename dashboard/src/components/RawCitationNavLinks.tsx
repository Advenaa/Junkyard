import { Link } from 'react-router';

export interface RawCitationNavLink {
  href: string;
  label: string;
}

interface RawCitationNavLinksProps {
  links: RawCitationNavLink[];
  metaLabel?: string;
  align?: 'start' | 'end';
}

function navLinkClass(): string {
  return 'text-xs font-mono uppercase tracking-wider text-accent hover:underline';
}

export function RawCitationNavLinks({ links, metaLabel, align = 'start' }: RawCitationNavLinksProps) {
  if (links.length === 0 && !metaLabel) {
    return null;
  }

  return (
    <div className={`flex items-center gap-3 flex-wrap ${align === 'end' ? 'justify-end' : ''}`}>
      {links.map((link) => (
        <Link key={`${link.href}:${link.label}`} to={link.href} className={navLinkClass()}>
          {link.label}
        </Link>
      ))}
      {metaLabel && <span className="font-mono text-[10px] text-text-secondary break-all">{metaLabel}</span>}
    </div>
  );
}
