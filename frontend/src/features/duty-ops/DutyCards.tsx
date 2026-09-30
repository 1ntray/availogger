import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { ContextLink } from '../../app/controls';
import { Icon } from '../../app/Icon';
import { Card, CardLink, Chip, DateBlock, EmptyState, PeopleStack, Skeleton } from '../../app/ui';
import { addDays, durationLabel, osloDate } from '../../dates';
import { useExchangeCounts } from '../exchange/ExchangeV2';
import { creditSign } from './credit-api';
import { ExchangeShiftActions } from './DutyExchanges';
import { participantLabel } from './presentation';
import { isOwnShift, shiftLinkLabel, ShiftList } from './ShiftList';
import type { DutyShift } from './types';

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', weekday: 'long' });
// Built from parts: browsers differ on the comma in "Thu, 1 Oct".
const shortDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short' });
const shortDate = (at: number) => shortDay.formatToParts(new Date(at)).filter(part => part.type !== 'literal').map(part => part.value).join(' ');
const range = (shift: DutyShift) => `${clock.format(new Date(shift.startsAt))}–${clock.format(new Date(shift.endsAt))}`;

export function endsInLabel(shift: Pick<DutyShift, 'endsAt'>, now: number) {
  const minutes = Math.max(0, Math.ceil((Date.parse(shift.endsAt) - now) / 60_000));
  return minutes < 60 ? `Ends in ${minutes} min` : `Ends in ${Math.floor(minutes / 60)} h`;
}
export function shiftProgress(shift: Pick<DutyShift, 'startsAt' | 'endsAt'>, now: number) {
  const start = Date.parse(shift.startsAt), end = Date.parse(shift.endsAt);
  return end <= start ? 100 : Math.min(100, Math.max(0, Math.round((now - start) / (end - start) * 100)));
}
/** "Today" / "Tomorrow" / weekday name for a schedule day, and its short date (with the year when it differs). */
export function dayHeading(date: string, today: string) {
  const at = Date.parse(`${date}T12:00:00Z`);
  const label = date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : weekday.format(at);
  return { label, date: `${shortDate(at)}${date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : ''}` };
}

export function DutyTabs({ canSwap }: { canSwap: boolean }) {
  const counts = useExchangeCounts();
  const review = counts?.review ?? 0;
  const tab = ({ isActive }: { isActive: boolean }) => `duty-tab${isActive ? ' is-active' : ''}`;
  return <nav className={`duty-tabs${canSwap ? '' : ' duty-tabs--two'}`} aria-label="Duty Ops sections">
    <NavLink to="/duty-ops" end className={tab}>Schedule</NavLink>
    {canSwap && <NavLink to="/duty-ops/exchanges" className={tab}>Exchanges{review > 0 && <><span className="duty-tab-badge" aria-hidden="true">{review}</span><span className="sr-only">, {review} need your answer</span></>}</NavLink>}
    <NavLink to="/activity?module=duty-ops" className={tab}>Activity</NavLink>
  </nav>;
}

export function OnDutyNowCard({ shift, now }: { shift: DutyShift; now: number }) {
  const own = isOwnShift(shift), progress = shiftProgress(shift, now);
  return <Card className="duty-now" title={<><span className="live-dot" aria-hidden="true" />On duty now</>} titleId={`duty-now-${shift.id}`}
    aside={<span className="duty-now-ends">{endsInLabel(shift, now)}</span>}>
    <div className={`duty-now-shift${own ? ' is-mine' : ''}`}>
      <time className="duty-now-time" dateTime={shift.startsAt}>{range(shift)}</time>
      {own && <Chip tone="soft">Your shift</Chip>}
      <PeopleStack people={shift.participants} total={shift.participantCount} label={participantLabel(shift, { you: true })} size={26} withLabel labelClassName="duty-participants" />
    </div>
    <div className="duty-progress" role="progressbar" aria-label="Shift progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
    {own && <div className="duty-card-actions"><ExchangeShiftActions shift={shift} /></div>}
  </Card>;
}

export function YourShiftsCard({ shifts, now, windowDays, canSwap }: { shifts: DutyShift[]; now: number; windowDays: number; canSwap: boolean }) {
  const today = osloDate(new Date(now));
  return <section className="card duty-mine" aria-labelledby="duty-mine">
    <div className="card-head"><h2 id="duty-mine">Your shifts</h2><span className="card-aside">Next {windowDays} days</span></div>
    {shifts.length ? <ul className="duty-mine-list">{shifts.map(shift => {
      const date = osloDate(new Date(shift.startsAt));
      const relative = date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : null;
      return <li key={shift.id} className="duty-row is-mine duty-mine-shift">
        <div className="duty-mine-block"><DateBlock at={Date.parse(shift.startsAt)} />
          <span className="duty-mine-text"><span className="duty-mine-time"><time dateTime={shift.startsAt}>{range(shift)}</time>{relative && <Chip tone={relative === 'Tomorrow' ? 'warning' : 'soft'}>{relative}</Chip>}</span>
            <span className="duty-mine-duration">{durationLabel(Date.parse(shift.startsAt), Date.parse(shift.endsAt))}</span></span></div>
        <PeopleStack people={shift.participants} total={shift.participantCount} label={participantLabel(shift, { you: true })} size={26} withLabel labelClassName="duty-participants" />
        <div className="duty-card-actions">
          <ContextLink className="ui-button ui-button--primary" to={`/duty-ops/shifts/${encodeURIComponent(shift.id)}`} aria-label={shiftLinkLabel(shift)}>Open shift</ContextLink>
          <ExchangeShiftActions shift={shift} />
        </div>
      </li>;
    })}</ul> : <EmptyState icon="calendar" title="No upcoming shifts" body={canSwap ? 'Pick one up from Exchanges.' : undefined} />}
  </section>;
}

export function ExchangesCard({ balance, children }: { balance: number | null; children: ReactNode }) {
  const counts = useExchangeCounts();
  if (!counts) return null;
  const tile = (value: number, label: string, warn = false) => <ContextLink className={`duty-stat${warn && value > 0 ? ' is-warning' : ''}`} to="/duty-ops/exchanges">
    {counts.ready ? <strong>{value}</strong> : <Skeleton width={24} height={22} />}<span>{label}</span></ContextLink>;
  return <Card className="duty-exchanges-card" title="Exchanges" titleId="duty-exchanges-title" aside={<CardLink to="/duty-ops/exchanges">Exchange centre</CardLink>}>
    <div className="duty-stats">{tile(counts.available, 'Available')}{tile(counts.requests, 'Requests')}{tile(counts.review, 'Needs review', true)}</div>
    {children}
    {balance !== null && <ContextLink className="duty-credit" to="/activity?module=duty-ops"><Icon name="coins" size={16} />
      <span>Credit balance <strong>{creditSign(balance)}</strong></span><span className="card-link">Activity<Icon name="chevron-right" size={14} /></span></ContextLink>}
  </Card>;
}

export function ScheduleCard({ groups, now, windowDays }: { groups: [string, DutyShift[]][]; now: number; windowDays: number }) {
  const today = osloDate(new Date(now));
  return <section id="exchange-schedule" className="card duty-schedule" aria-labelledby="duty-schedule">
    <div className="card-head"><h2 id="duty-schedule">Schedule</h2><span className="card-aside">Times in Oslo</span></div>
    {groups.length ? groups.map(([date, shifts]) => {
      const heading = dayHeading(date, today);
      return <section key={date} className="duty-day" aria-label={`${heading.label} ${heading.date}`}>
        <h3><strong>{heading.label}</strong> <time dateTime={date}>{heading.date}</time></h3>
        <ShiftList shifts={shifts} linkToShift now={now} renderAction={shift => <ExchangeShiftActions shift={shift} />} />
      </section>;
    }) : <EmptyState icon="calendar" title={`No shifts in the next ${windowDays} days`} />}
  </section>;
}

export function DutyOpsSkeleton() {
  return <div className="duty-skeleton" role="status" aria-label="Loading Duty Ops">
    <div className="card"><Skeleton width="40%" /><Skeleton height={56} /><Skeleton width={180} height={36} /></div>
    <div className="card"><Skeleton width="30%" />{[0, 1, 2, 3].map(index => <span key={index} className="duty-skeleton-row"><Skeleton width={44} height={32} /><Skeleton width="55%" /></span>)}</div>
  </div>;
}
