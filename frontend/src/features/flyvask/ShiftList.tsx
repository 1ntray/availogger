import { dateLabel, participantLabel, timeLabel } from './presentation';
import type { FlyvaskShift } from './types';
import type { ReactNode } from 'react';
import { AttentionDetail } from '../../app/AttentionDetail';

export function ShiftList({ shifts, showDate = false, renderAction }: { shifts: FlyvaskShift[]; showDate?: boolean; renderAction?: (shift: FlyvaskShift) => ReactNode }) {
  return <ul>{shifts.map(s => <li key={s.id} className={`duty-row ${s.participants.some(p => p.isCurrentUser) ? 'is-mine' : ''} ${s.status === 'CANCELLED' ? 'is-cancelled' : ''}`}>
    <div className="duty-row-top">{showDate && <span className="duty-row-date">{dateLabel(s.startsAt)}</span>}
      <time dateTime={s.startsAt}>{timeLabel(s)}</time>
      {s.participants.some(p => p.isCurrentUser) && <span className="sr-only">Your shift</span>}
      {s.status === 'CANCELLED' && <span className="duty-status">Cancelled</span>}
      {s.status === 'COMPLETED' && <span className="duty-status">Completed</span>}
      {s.status === 'PARTIALLY_COMPLETED' && <span className="duty-status">Partially completed</span>}
    </div><p className="duty-participants">{participantLabel(s)}</p>
    {s.assignmentsDiffer && s.flightlogger && <AttentionDetail label="Assignments differ from FlightLogger"><p>Studentportal is the current assignment. FlightLogger records: {participantLabel(s.flightlogger)}</p></AttentionDetail>}
    {s.classroomName && <span className="flyvask-place">{s.classroomName}</span>}
    <div className="duty-row-actions">{renderAction?.(s)}</div>
  </li>)}</ul>;
}
