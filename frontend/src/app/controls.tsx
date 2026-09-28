import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { cacheAgeLabel, cacheTimeInOslo } from '../cache-age';
import { Icon } from './Icon';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function ActionButton({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button {...props} type={type} className={`ui-button ui-button--${variant} ${className}`.trim()} />;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="page-header"><h1>{title}</h1>{children}</div>;
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="back-link" to={to}><span aria-hidden="true">←</span> {children}</Link>;
}

export function RefreshControl({ onRefresh, label, loading = false, updatedAt, now = Date.now(), retry = false }: {
  onRefresh: () => void; label: string; loading?: boolean; updatedAt?: string | null; now?: number; retry?: boolean;
}) {
  return <div className="refresh-control">
    {updatedAt && <time dateTime={updatedAt} title={cacheTimeInOslo(updatedAt)}>{cacheAgeLabel(updatedAt, now)}</time>}
    <ActionButton variant={retry ? 'secondary' : 'ghost'} onClick={onRefresh} disabled={loading} aria-label={`${retry ? 'Retry' : 'Refresh'} ${label}`}>
      <Icon name="reload" />{retry && <span>Retry</span>}
    </ActionButton>
  </div>;
}
