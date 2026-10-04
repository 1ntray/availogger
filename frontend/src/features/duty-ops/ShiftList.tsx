import { dateLabel, isOwnShift, participantLabel, timeLabel } from './presentation';
import type { DutyShift } from './types';
import type { ReactNode } from 'react';
import { ContextLink } from '../../app/controls';
import { AttentionDetail } from '../../app/AttentionDetail';

export function ShiftList({ shifts, showDate = false, renderAction, linkToShift = false }: { shifts: DutyShift[]; showDate?: boolean; renderAction?: (shift: DutyShift) => ReactNode; linkToShift?: boolean }) {
  return <ul>{shifts.map(s => <li key={s.id} className={`duty-row ${isOwnShift(s) ? 'is-mine' : ''} ${s.status === 'CANCELLED' ? 'is-cancelled' : ''}`}>
    <div className="duty-row-top">{showDate && <span className="duty-row-date">{dateLabel(s.startsAt)}</span>}
      <time dateTime={s.startsAt}>{timeLabel(s)}</time>
      {isOwnShift(s) && <span className="sr-only">Your shift</span>}
      {s.status === 'CANCELLED' && <span className="duty-status">Cancelled</span>}
      {s.status === 'COMPLETED' && <span className="duty-status">Completed</span>}
      {s.status === 'PARTIALLY_COMPLETED' && <span className="duty-status">Partially completed</span>}
    </div><p className="duty-participants">{participantLabel(s)}</p>
    {s.participantIntegrity?.status === 'CONFLICT' ? <AttentionDetail label="FlightLogger assignment differs"><p>{s.participantIntegrity.reason === 'RAW_IDENTITY_OVERCOUNT' ? 'Participant identities are still being reconciled with FlightLogger.' : 'Studentportal keeps the agreed assignment while FlightLogger is being reconciled.'}</p></AttentionDetail> :
      s.assignmentsDiffer && s.flightlogger && <AttentionDetail label="Assignments differ from FlightLogger"><p>Studentportal is the current assignment. FlightLogger records: {participantLabel(s.flightlogger)}</p></AttentionDetail>}
    <div className="duty-row-actions">
      {renderAction?.(s)}
      {linkToShift && isOwnShift(s) && <ContextLink className="duty-row-link" to={`/duty-ops/shifts/${encodeURIComponent(s.id)}`} aria-label={`Open your Duty Ops shift ${dateLabel(s.startsAt)} ${timeLabel(s)}`}>Open shift</ContextLink>}
    </div>
  </li>)}</ul>;
}
