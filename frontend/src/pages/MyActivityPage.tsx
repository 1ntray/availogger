import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '../app/CurrentUser';
import { PERMISSIONS } from '../../../shared/authorization';
import { loadSwapHistory as loadDutyHistory } from '../features/duty-ops/exchange-api';
import { loadSwapHistory as loadFlyvaskHistory } from '../features/flyvask/exchange-api';
import { loadHistory as loadBrakkevaktHistory } from '../features/brakkevakt/api';
import { acceptedLabel, historyShiftLabel, userName } from '../features/duty-ops/exchange-presentation';
import { weekLabel, personName } from '../features/brakkevakt/presentation';

type Module = 'duty-ops' | 'flyvask' | 'brakkevakt';
type Entry = { id: string; module: Module; acceptedAt: string; text: string; detail: string };
type Source = { entries: Entry[]; nextCursor: string | null; error: string; loading: boolean };
const modules: { key: Module; label: string; permission: string }[] = [
  { key: 'duty-ops', label: 'Duty Ops', permission: PERMISSIONS.dutyOpsView },
  { key: 'flyvask', label: 'Flyvask', permission: PERMISSIONS.flyvaskView },
  { key: 'brakkevakt', label: 'Brakkevakt', permission: PERMISSIONS.brakkevaktView },
];
const empty = (): Source => ({ entries: [], nextCursor: null, error: '', loading: false });
const initial = (): Record<Module, Source> => ({ 'duty-ops': empty(), flyvask: empty(), brakkevakt: empty() });
async function load(module: Module, signal: AbortSignal, cursor?: string): Promise<Pick<Source, 'entries' | 'nextCursor'>> {
  if (module === 'brakkevakt') {
    const data = await loadBrakkevaktHistory(signal, cursor);
    return { nextCursor: data.nextCursor, entries: data.entries.map(entry => ({ id: entry.id, module, acceptedAt: entry.acceptedAt,
      text: `Swapped with ${personName(entry.counterparty)}`, detail: `${weekLabel(entry.givenWeekStart)} → ${weekLabel(entry.receivedWeekStart)}` })) };
  }
  const data = module === 'duty-ops' ? await loadDutyHistory(signal, cursor) : await loadFlyvaskHistory(signal, cursor);
  return { nextCursor: data.nextCursor, entries: data.entries.map(entry => ({ id: entry.id, module, acceptedAt: entry.acceptedAt,
    text: entry.type === 'GIVE_AWAY' ? entry.givenShift ? `Gave shift to ${userName(entry.counterparty)}` : `Took shift from ${userName(entry.counterparty)}` : `Swapped with ${userName(entry.counterparty)}`,
    detail: [entry.givenShift && `Gave ${historyShiftLabel(entry.givenShift)}`, entry.receivedShift && `Received ${historyShiftLabel(entry.receivedShift)}`].filter(Boolean).join(' · ') })) };
}
export function MyActivityPage() {
  const { user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const filter = modules.some(module => module.key === params.get('module')) ? params.get('module') as Module : 'all';
  const available = modules.filter(module => user?.permissions.includes(module.permission as typeof PERMISSIONS[keyof typeof PERMISSIONS]));
  const [sources, setSources] = useState(initial);
  const [reload, setReload] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setSources(initial());
    for (const module of available) {
      setSources(old => ({ ...old, [module.key]: { ...old[module.key], loading: true } }));
      void load(module.key, controller.signal).then(result => {
        if (!controller.signal.aborted) setSources(old => ({ ...old, [module.key]: { ...result, error: '', loading: false } }));
      }).catch(cause => {
        if (!controller.signal.aborted) setSources(old => ({ ...old, [module.key]: { ...old[module.key], error: cause instanceof Error ? cause.message : 'Could not load activity.', loading: false } }));
      });
    }
    return () => { controller.abort(); if (active.current === controller) active.current = null; };
  }, [user?.subject, reload, user?.permissions.join(',')]);
  async function more(module: Module) {
    const cursor = sources[module].nextCursor;
    const controller = active.current;
    if (!cursor || sources[module].loading || !controller) return;
    setSources(old => ({ ...old, [module]: { ...old[module], loading: true, error: '' } }));
    try {
      const next = await load(module, controller.signal, cursor);
      if (!controller.signal.aborted) setSources(old => ({ ...old, [module]: { entries: [...old[module].entries, ...next.entries.filter(entry => !old[module].entries.some(existing => existing.id === entry.id))], nextCursor: next.nextCursor, error: '', loading: false } }));
    } catch (cause) { if (!controller.signal.aborted) setSources(old => ({ ...old, [module]: { ...old[module], error: cause instanceof Error ? cause.message : 'Could not load more activity.', loading: false } })); }
  }
  const shown = available.filter(module => filter === 'all' || filter === module.key);
  const entries = shown.flatMap(module => sources[module.key].entries).sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt) || a.id.localeCompare(b.id));
  return <section className="activity-page"><div className="duty-heading"><h1>My activity</h1><button onClick={() => setReload(n => n + 1)}>Reload</button></div>
    <nav className="activity-filters" aria-label="Activity filter"><button aria-pressed={filter === 'all'} onClick={() => setParams({})}>All</button>{available.map(module => <button key={module.key} aria-pressed={filter === module.key} onClick={() => setParams({ module: module.key })}>{module.label}</button>)}</nav>
    {shown.map(module => sources[module.key].error && <p key={module.key} role="alert">{module.label}: {sources[module.key].error}</p>)}
    {shown.some(module => sources[module.key].loading) && <p role="status">Loading activity…</p>}
    {entries.length ? <ol className="activity-list">{entries.map(entry => <li key={`${entry.module}:${entry.id}`}><span>{modules.find(module => module.key === entry.module)?.label}</span><strong>{entry.text}</strong><p>{entry.detail}</p><time dateTime={entry.acceptedAt}>{acceptedLabel(entry.acceptedAt)}</time></li>)}</ol> : !shown.some(module => sources[module.key].loading || sources[module.key].error) && <p>No accepted activity yet.</p>}
    <div className="activity-more">{shown.filter(module => sources[module.key].nextCursor).map(module => <button key={module.key} disabled={sources[module.key].loading} onClick={() => void more(module.key)}>Load more {module.label}</button>)}</div>
  </section>;
}
