import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from './Icon';

const dateParts = (at: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', ...options }).format(new Date(at));

/**
 * Three-letter name code the students use: first letter of the first name + first two letters of the
 * last word of the last name (Mike Myers → MMY, Chris Hems Dal → CDA). Falls back to the letters available.
 */
export function nameCode(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined) {
  const first = user?.firstName?.trim().split(/\s+/)[0] ?? '', last = user?.lastName?.trim().split(/\s+/).at(-1) ?? '';
  const code = first && last ? first[0] + last.slice(0, 2) : (first || last).slice(0, 3) || user?.email?.trim()[0] || '?';
  return code.toLocaleUpperCase('nb-NO');
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

export function Avatar({ user, size = 32 }: { user: Parameters<typeof nameCode>[0]; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }} aria-hidden="true">{nameCode(user)}</span>;
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

type StackPerson = { firstName?: string | null; lastName?: string | null; isCurrentUser?: boolean };
/**
 * Who is on a shift: a name-code pill per signed-in student (current user first, filled) and a dashed
 * dot per student who has not signed in yet (known only as a head count from FlightLogger).
 */
export function PeopleStack({ people, total, label, size = 22, withLabel = false, labelClassName = '' }: {
  people: StackPerson[]; total: number; label: string; size?: 22 | 26; withLabel?: boolean; labelClassName?: string;
}) {
  const ordered = [...people].sort((a, b) => Number(!!b.isCurrentUser) - Number(!!a.isCurrentUser));
  const unknown = Math.max(0, total - people.length), dots = Math.min(unknown, Math.max(0, 3 - ordered.length)), extra = unknown - dots;
  return <span className={`people-stack people-stack--${size}`}>
    <span className="people-stack-faces" aria-hidden="true">
      {ordered.map((person, index) => <span key={index} className={`people-code${person.isCurrentUser ? ' is-you' : ''}`}>{nameCode(person)}</span>)}
      {Array.from({ length: dots }, (_, index) => <span key={`dot-${index}`} className="people-dot"><Icon name="account" size={Math.round(size / 2)} /></span>)}
      {extra > 0 && <span className="chip chip--neutral">+{extra}</span>}
    </span>
    {/* The label is the accessible text; the pills and dots are decoration. */}
    <span className={`${withLabel ? 'people-stack-label' : 'sr-only'} ${labelClassName}`.trim()}>{label}</span>
  </span>;
}
