import { dateLabel, participantLabel, timeLabel } from './presentation';
import type { DutyShift } from './types';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AttentionDetail } from '../../app/AttentionDetail';

export function ShiftList({ shifts, showDate = false, renderAction, linkToShift = false }: { shifts: DutyShift[]; showDate?: boolean; renderAction?: (shift: DutyShift) => ReactNode; linkToShift?: boolean }) {
  return <ul>{shifts.map(s => <li key={s.id} className={`duty-row ${s.participants.some(p => p.isCurrentUser) ? 'is-mine' : ''} ${s.status === 'CANCELLED' ? 'is-cancelled' : ''}`}>
    <div className="duty-row-top">{showDate && <span className="duty-row-date">{dateLabel(s.startsAt)}</span>}
      <time dateTime={s.startsAt}>{timeLabel(s)}</time>
      {s.participants.some(p => p.isCurrentUser) && <span className="sr-only">Your shift</span>}
      {s.status === 'CANCELLED' && <span className="duty-status">Cancelled</span>}
      {s.status === 'COMPLETED' && <span className="duty-status">Completed</span>}
      {s.status === 'PARTIALLY_COMPLETED' && <span className="duty-status">Partially completed</span>}
    </div><p className="duty-participants">{participantLabel(s)}</p>
    {s.assignmentsDiffer && s.flightlogger && <AttentionDetail label="Assignments differ from FlightLogger"><p>Studentportal is the current assignment. FlightLogger records: {participantLabel(s.flightlogger)}</p></AttentionDetail>}
    {linkToShift && <Link className="duty-row-link" to={`/duty-ops/shifts/${encodeURIComponent(s.id)}`} aria-label={`Open Duty Ops shift ${dateLabel(s.startsAt)} ${timeLabel(s)}`}><span aria-hidden="true">→</span></Link>}
    {renderAction?.(s)}
  </li>)}</ul>;
}
