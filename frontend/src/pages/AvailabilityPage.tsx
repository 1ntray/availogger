import { useEffect, useMemo, useState } from 'react';
import { loadAvailability, OnboardingRequiredError } from '../api';
import { useCurrentUser } from '../app/CurrentUser';
import { cacheAgeLabel, cacheTimeInOslo } from '../cache-age';
import { addDays, dateKey, datesInRange, dateWindow, osloDate } from '../dates';
import { useCalendarWidth } from '../use-calendar-width';
import type { AvailabilityResponse, AvailabilityStatus } from '../types';
import { Icon } from '../app/Icon';

const dayFormatter = new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' });
const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function instructorName(instructor: AvailabilityResponse['instructors'][number]): string {
  return instructor.callSign || `${instructor.firstName} ${instructor.lastName}`.trim() || instructor.id;
}

function monthGroups(dates: Date[]): { name: string; count: number }[] {
  const groups: { name: string; count: number }[] = [];
  for (const date of dates) {
    const name = monthFormatter.format(date);
    if (groups.at(-1)?.name === name) groups[groups.length - 1].count++;
    else groups.push({ name, count: 1 });
  }
  return groups;
}

function weekNumber(date: Date): number {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function AvailabilityPage() {
  const { refresh } = useCurrentUser();
  const [viewStartDate, setViewStartDate] = useState(() => osloDate(new Date()));
  const { container, dayCount } = useCalendarWidth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const today = osloDate(new Date(now));
  const range = useMemo(() => dateWindow(viewStartDate, dayCount || 1), [viewStartDate, dayCount]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (dayCount === null) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    loadAvailability(range.from, range.to, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setData(result); setNow(Date.now()); } })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (cause instanceof OnboardingRequiredError) { void refresh().catch(() => {}); return; }
        setError(cause instanceof Error ? cause.message : 'Could not load availability.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range.from, range.to, dayCount, refreshKey, refresh]);

  const dates = useMemo(() => datesInRange(range.from, range.to), [range.from, range.to]);
  const dayOffset = data ? Math.round((Date.parse(`${range.from}T12:00:00Z`) - Date.parse(`${data.from}T12:00:00Z`)) / 86400000) : 0;
  const instructors = useMemo(() => (data?.instructors || []).filter(instructor =>
    `${instructor.firstName} ${instructor.lastName} ${instructor.callSign}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  ), [data, query]);

  return <section className="availability-page">
      <h1>Instructor availability</h1>
      <div className="availability-meta"><p>Times shown in Europe/Oslo</p>{data && !loading && !error && <p className="cache-age">{data.cachedAt ? <time dateTime={data.cachedAt} title={cacheTimeInOslo(data.cachedAt)}>{cacheAgeLabel(data.cachedAt, now)}</time> : 'Update time unavailable'}</p>}</div>

      <div className="toolbar">
        <div className="date-window-nav" aria-label="Date window navigation">
          <button aria-label="Previous dates" onClick={() => setViewStartDate(value => addDays(value, -(dayCount || 1)))} disabled={dayCount === null}>‹</button>
          <span aria-live="polite">{dayCount === null ? '…' : range.label}</span>
          <button aria-label="Next dates" onClick={() => setViewStartDate(addDays(range.to, 1))} disabled={dayCount === null}>›</button>
        </div>
        <button className="today-button" onClick={() => setViewStartDate(today)} disabled={viewStartDate === today}>Today</button>
        <button className="refresh-button" aria-label="Reload view" onClick={() => setRefreshKey(value => value + 1)} disabled={loading}><Icon name="reload" /><span className="reload-label">Reload view</span></button>
        <label className="search-box"><span className="sr-only">Find instructor</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find instructor…" type="search" /></label>
      </div>

      <div className="legend" aria-label="Availability legend">
        <span><i className="legend-dot available" /> Available</span>
        <span><i className="legend-dot unavailable" /> Unavailable</span>
        <span><i className="legend-dot undefined" /> No information</span>
      </div>

      <div className="calendar-container" ref={container}>
      {loading && <div className="message" role="status">Loading instructor availability…</div>}
      {error && <div className="message error" role="alert"><strong>Availability could not be loaded.</strong><p>{error}</p><button onClick={() => setRefreshKey(value => value + 1)}>Try again</button></div>}
      {!loading && !error && data && data.instructors.length === 0 && <div className="message">No flight instructors were returned for this account.</div>}
      {!loading && !error && data && data.instructors.length > 0 && instructors.length === 0 && <div className="message">No instructors match “{query}”.</div>}

      {!loading && !error && data && instructors.length > 0 && <>
        <p className="result-count">{instructors.length} instructor{instructors.length === 1 ? '' : 's'}</p>
        <div className="calendar-frame" tabIndex={0} role="region" aria-label="Instructor availability calendar">
          <table className="calendar">
            <caption className="sr-only">Instructor availability, {range.label}</caption>
            <colgroup><col className="instructor-column" />{dates.map(date => <col key={dateKey(date)} />)}</colgroup>
            <thead>
              <tr className="month-row"><th className="name-cell" rowSpan={2} scope="col">Instructor</th>{monthGroups(dates).map(group => <th key={group.name} colSpan={group.count} scope="colgroup">{group.name}</th>)}</tr>
              <tr className="date-row">{dates.map((date, index) => {
                const monday = date.getUTCDay() === 1;
                return <th key={dateKey(date)} className={`${monday && index > 0 ? 'week-start' : ''} ${date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 'weekend' : ''}`} scope="col" title={dateKey(date)}>
                  <span className="week-label">{monday || index === 0 ? `W${weekNumber(date)}` : '\u00a0'}</span><span>{dayFormatter.format(date)}</span><strong>{date.getUTCDate()}</strong>
                </th>;
              })}</tr>
            </thead>
            <tbody>{instructors.map(instructor => <tr key={instructor.id}>
              <th className="name-cell" scope="row" title={`${instructor.firstName} ${instructor.lastName}`.trim()}>{instructorName(instructor)}</th>
              {dates.map((date, index) => {
                const status: AvailabilityStatus = instructor.days[index + dayOffset] || 'undefined';
                const label = `${instructorName(instructor)}, ${dateKey(date)}: ${status === 'undefined' ? 'no availability information' : status}`;
                return <td key={dateKey(date)} className={`${status} ${date.getUTCDay() === 1 && index > 0 ? 'week-start' : ''}`} title={label}><span className="sr-only">{label}</span></td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="footnote">A day is unavailable if any recorded unavailable period overlaps it; otherwise available if an available period overlaps it. Blank information means no matching record was returned.</p>
      </>}
      </div>
  </section>;
}

export default AvailabilityPage;
