import { dateLabel, participantLabel, timeLabel } from './presentation';
import type { DutyShift } from './types';
import type { ReactNode } from 'react';
import { ContextLink } from '../../app/controls';
import { AttentionDetail } from '../../app/AttentionDetail';
import { Icon } from '../../app/Icon';
import { Chip, PeopleStack } from '../../app/ui';

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const isOwnShift = (shift: Pick<DutyShift, 'participants'>) => shift.participants.some(person => person.isCurrentUser);
export const shiftLinkLabel = (shift: DutyShift) => `Open your Duty Ops shift ${dateLabel(shift.startsAt)} ${timeLabel(shift)}`;

function StatusChip({ shift, now }: { shift: DutyShift; now?: number }) {
  if (shift.status === 'CANCELLED') return <Chip>Cancelled</Chip>;
  if (shift.status === 'COMPLETED') return <Chip>Completed</Chip>;
  if (shift.status === 'PARTIALLY_COMPLETED') return <Chip>Partially completed</Chip>;
  if (now !== undefined && Date.parse(shift.startsAt) <= now && Date.parse(shift.endsAt) > now) return <Chip tone="soft"><span className="live-dot" aria-hidden="true" />On now</Chip>;
  if (isOwnShift(shift)) return <span aria-hidden="true"><Chip tone="soft">Your shift</Chip></span>;
  return null;
}

/** Schedule rows: start over end time, who is on it, status, and the shift's exchange actions. */
export function ShiftList({ shifts, showDate = false, renderAction, linkToShift = false, now }: {
  shifts: DutyShift[]; showDate?: boolean; renderAction?: (shift: DutyShift) => ReactNode; linkToShift?: boolean; now?: number;
}) {
  return <ul className="duty-rows">{shifts.map(s => {
    const own = isOwnShift(s), action = renderAction?.(s), link = linkToShift && own;
    const overnight = timeLabel(s).split('–')[1] ?? clock.format(new Date(s.endsAt));
    return <li key={s.id} className={`duty-row${own ? ' is-mine' : ''}${s.status === 'CANCELLED' ? ' is-cancelled' : ''}${link ? ' has-link' : ''}`}>
      <div className="duty-row-main">
        <time className="duty-row-time" dateTime={s.startsAt}>
          {showDate && <span className="duty-row-date">{dateLabel(s.startsAt)}</span>}
          <strong>{clock.format(new Date(s.startsAt))}</strong><span>{overnight}</span>
        </time>
        {own && <span className="sr-only">Your shift</span>}
        <PeopleStack people={s.participants} total={s.participantCount} label={participantLabel(s, { you: true })} labelClassName="duty-participants" />
        <span className="duty-row-end"><StatusChip shift={s} now={now} />
          {link && <ContextLink className="duty-row-link" to={`/duty-ops/shifts/${encodeURIComponent(s.id)}`} aria-label={shiftLinkLabel(s)}><Icon name="chevron-right" size={16} /></ContextLink>}</span>
      </div>
      {s.assignmentsDiffer && s.flightlogger && <AttentionDetail label="Assignments differ from FlightLogger"><p>Studentportal is the current assignment. FlightLogger records: {participantLabel(s.flightlogger)}</p></AttentionDetail>}
      {action && <div className="duty-row-actions">{action}</div>}
    </li>;
  })}</ul>;
}
