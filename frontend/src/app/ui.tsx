import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from './Icon';

const dateParts = (at: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', ...options }).format(new Date(at));

export function initials(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined) {
  const first = user?.firstName?.trim(), last = user?.lastName?.trim();
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  const single = first || last || user?.email?.trim();
  return single ? single[0].toUpperCase() : '?';
}

export function Card({ title, titleId, aside, children, className = '', label }: {
  title?: ReactNode; titleId?: string; aside?: ReactNode; children: ReactNode; className?: string; label?: string;
}) {
  return <section className={`card ${className}`.trim()} aria-labelledby={title && titleId ? titleId : undefined} aria-label={title ? undefined : label}>
    {title && <div className="card-head"><h2 id={titleId}>{title}</h2>{aside}</div>}
    {children}
  </section>;
}

export function Chip({ tone = 'neutral', children }: { tone?: 'soft' | 'warning' | 'neutral'; children: ReactNode }) {
  return <span className={`chip chip--${tone}`}>{children}</span>;
}

export function EmptyState({ icon, title, body }: { icon: IconName; title: string; body?: string }) {
  return <div className="empty-state"><span className="icon-tile"><Icon name={icon} size={20} /></span>
    <span className="empty-state-text"><strong>{title}</strong>{body && <span>{body}</span>}</span></div>;
}

export function Avatar({ user, size = 32 }: { user: Parameters<typeof initials>[0]; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">{initials(user)}</span>;
}

export function DateBlock({ at }: { at: number }) {
  return <span className="date-block" aria-hidden="true">
    <span>{dateParts(at, { weekday: 'short' })}</span><strong>{dateParts(at, { day: 'numeric' })}</strong><span>{dateParts(at, { month: 'short' })}</span>
  </span>;
}

export function Skeleton({ width = '100%', height = 14 }: { width?: number | string; height?: number }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="card-link" to={to}>{children}<Icon name="chevron-right" size={14} /></Link>;
}
