import type { ReactNode } from 'react';

/** Reveals secondary context without making users compare sources by default. */
export function AttentionDetail({ label, children }: { label: string; children: ReactNode }) {
  return <details className="attention-detail"><summary><span className="attention-dot" aria-hidden="true" />{label}</summary><div className="attention-content">{children}</div></details>;
}
