import { ApplicationError } from '../application-error';
import type { ApplicationUser } from '../users';
import { eligibleSource, fuelProfile, type FlightRow, type FuelRow } from './service';

export type FuelChoice = { kind: 'PRESET'; presetKey: string } | { kind: 'QUANTITY'; quantityValue: number; quantityUnit: 'L' | 'US_GAL' };
const conflict = () => new ApplicationError('This fuel request changed. Reload the flight and try again.', 409, 'FUEL_CONFLICT');
export function fuelId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new ApplicationError('Choose a valid flight or fuel request.', 400);
  return value;
}
export async function ownedFlight(db: D1Database, user: ApplicationUser, flightId: string): Promise<FlightRow> {
  const row = await db.prepare('SELECT f.* FROM flights f JOIN flight_students s ON s.flight_id=f.id WHERE f.id=? AND s.user_id=?')
    .bind(flightId, user.id).first<FlightRow>();
  if (!row) throw new ApplicationError('Flight not found.', 404);
  return row;
}
async function choiceFor(db: D1Database, flight: FlightRow, submitted: FuelChoice) {
  if (!eligibleSource(flight)) throw new ApplicationError('Fuel requests are unavailable for this flight.', 409);
  const profile = await fuelProfile(db, flight);
  if (!profile) throw new ApplicationError('This aircraft has no verified fuel profile.', 409);
  if (submitted.kind === 'PRESET') {
    const preset = profile.presets.find(p => p.key === submitted.presetKey);
    if (!preset) throw new ApplicationError('Choose a fuel option for this aircraft.', 400);
    return { profileId: profile.id, key: preset.key, label: preset.label, value: null, unit: null };
  }
  if (!Number.isFinite(submitted.quantityValue) || submitted.quantityValue <= 0 || submitted.quantityValue > 1000 ||
      !['L', 'US_GAL'].includes(submitted.quantityUnit)) throw new ApplicationError('Enter a valid fuel quantity and unit.', 400);
  return { profileId: profile.id, key: null, label: null, value: submitted.quantityValue, unit: submitted.quantityUnit };
}
const authorized = `EXISTS(SELECT 1 FROM flight_students s JOIN effective_user_permissions p ON p.user_id=s.user_id
  WHERE s.flight_id=f.id AND s.user_id=? AND p.permission_key='fuel.request')`;
const eligible = `f.status='OPEN' AND f.flight_starts_at IS NOT NULL AND f.flightlogger_aircraft_id IS NOT NULL
  AND f.aircraft_class IS NOT 'SIMULATOR' AND f.departure_airport_id='2953' AND f.ends_at>?`;
function guard(db: D1Database) {
  return db.prepare('UPDATE fuel_request_state SET revision=CASE WHEN changes()=1 THEN revision+1 ELSE -1 END WHERE id=1');
}
export async function createFuel(db: D1Database, user: ApplicationUser, flightId: string, submitted: FuelChoice) {
  const flight = await ownedFlight(db, user, flightId), choice = await choiceFor(db, flight, submitted);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO fuel_requests (id,flight_id,requested_by_user_id,status,request_kind,fuel_profile_id,preset_key,preset_label_snapshot,
        quantity_value,quantity_unit,flightlogger_booking_id,flight_starts_at_snapshot,flight_ends_at_snapshot,
        flightlogger_aircraft_id_snapshot,aircraft_callsign_snapshot,aircraft_model_snapshot,departure_airport_id_snapshot,created_at,updated_at)
        SELECT ?,f.id,?,'PENDING',?,?,?,?,?,?,f.flightlogger_booking_id,f.flight_starts_at,f.flight_ends_at,
          f.flightlogger_aircraft_id,f.aircraft_callsign,f.aircraft_model,f.departure_airport_id,?,?
        FROM flights f WHERE f.id=? AND ${authorized} AND ${eligible}
          AND f.flightlogger_aircraft_id=? AND f.aircraft_callsign IS ? AND f.aircraft_model IS ?`)
        .bind(id,user.id,submitted.kind,choice.profileId,choice.key,choice.label,choice.value,choice.unit,now,now,
          flightId,user.id,now,flight.flightlogger_aircraft_id,flight.aircraft_callsign,flight.aircraft_model),
      guard(db),
      db.prepare(`INSERT INTO fuel_request_events(id,fuel_request_id,actor_user_id,type,created_at,aircraft_id_snapshot,request_label_snapshot)
        SELECT ?,id,?,'REQUEST_CREATED',?,flightlogger_aircraft_id_snapshot,preset_label_snapshot FROM fuel_requests WHERE id=?`)
        .bind(crypto.randomUUID(),user.id,now,id),
    ]);
  } catch { throw conflict(); }
  return { id, status:'PENDING' as const };
}
export async function updateFuel(db: D1Database, user: ApplicationUser, flightId: string, submitted: FuelChoice) {
  const flight = await ownedFlight(db,user,flightId), choice=await choiceFor(db,flight,submitted);
  const previous=await db.prepare("SELECT id,status,revision FROM fuel_requests WHERE flight_id=? AND status<>'CANCELLED'")
    .bind(flightId).first<{id:string;status:string;revision:number}>();
  if(!previous||!['PENDING','NEEDS_REVIEW'].includes(previous.status))throw conflict();
  const now=new Date().toISOString();
  try {
    await db.batch([
      db.prepare(`UPDATE fuel_requests AS r SET status='PENDING',review_reason=NULL,request_kind=?,fuel_profile_id=?,preset_key=?,
        preset_label_snapshot=?,quantity_value=?,quantity_unit=?,flight_starts_at_snapshot=(SELECT flight_starts_at FROM flights WHERE id=r.flight_id),
        flight_ends_at_snapshot=(SELECT flight_ends_at FROM flights WHERE id=r.flight_id),
        flightlogger_aircraft_id_snapshot=(SELECT flightlogger_aircraft_id FROM flights WHERE id=r.flight_id),
        aircraft_callsign_snapshot=(SELECT aircraft_callsign FROM flights WHERE id=r.flight_id),
        aircraft_model_snapshot=(SELECT aircraft_model FROM flights WHERE id=r.flight_id),
        departure_airport_id_snapshot=(SELECT departure_airport_id FROM flights WHERE id=r.flight_id),updated_at=?,revision=revision+1
        WHERE r.id=? AND r.status=? AND r.revision=? AND EXISTS
        (SELECT 1 FROM flights f WHERE f.id=r.flight_id AND ${authorized} AND ${eligible}
          AND f.flightlogger_aircraft_id=? AND f.aircraft_callsign IS ? AND f.aircraft_model IS ?)`)
        .bind(submitted.kind,choice.profileId,choice.key,choice.label,choice.value,choice.unit,now,
          previous.id,previous.status,previous.revision,user.id,now,
          flight.flightlogger_aircraft_id,flight.aircraft_callsign,flight.aircraft_model),
      guard(db),
      db.prepare(`INSERT INTO fuel_request_events(id,fuel_request_id,actor_user_id,type,created_at,aircraft_id_snapshot,request_label_snapshot)
        SELECT ?,id,?,?,?,flightlogger_aircraft_id_snapshot,preset_label_snapshot
        FROM fuel_requests WHERE id=?`)
        .bind(crypto.randomUUID(),user.id,previous.status==='NEEDS_REVIEW'?'REVIEW_RESOLVED':'REQUEST_UPDATED',now,previous.id),
    ]);
  } catch { throw conflict(); }
  return { status:'PENDING' as const };
}
export async function cancelFuel(db:D1Database,user:ApplicationUser,flightId:string) {
  const prior=await db.prepare("SELECT id,revision FROM fuel_requests WHERE flight_id=? AND status='PENDING'")
    .bind(flightId).first<{id:string;revision:number}>();
  if(!prior)throw conflict();
  const now=new Date().toISOString();
  try {
    await db.batch([
      db.prepare(`UPDATE fuel_requests SET status='CANCELLED',cancelled_at=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND status='PENDING'
        AND EXISTS(SELECT 1 FROM flight_students s JOIN effective_user_permissions p ON p.user_id=s.user_id
          WHERE s.flight_id=fuel_requests.flight_id AND s.user_id=? AND p.permission_key='fuel.request')`)
        .bind(now,now,prior.id,prior.revision,user.id),
      guard(db),
      db.prepare(`INSERT INTO fuel_request_events(id,fuel_request_id,actor_user_id,type,created_at,aircraft_id_snapshot,request_label_snapshot)
        SELECT ?,id,?,'REQUEST_CANCELLED',?,flightlogger_aircraft_id_snapshot,preset_label_snapshot
        FROM fuel_requests WHERE id=?`)
        .bind(crypto.randomUUID(),user.id,now,prior.id),
    ]);
  } catch { throw conflict(); }
  return {status:'CANCELLED' as const};
}

export type Task = { id:string;flightId:string;flightStartsAt:string;attentionFrom:string;aircraft:{id:string;callSign:string|null;model:string|null};
  pilot:string;requested:string;status:string;earlierFlight:{endsAt:string;timeSource:'flight'|'booking';pilot:string|null}|null };
type TaskRow=FuelRow & { flight_starts_at:string;aircraft_callsign:string|null;aircraft_model:string|null;
  first_name:string|null;last_name:string|null;earlier_end:string|null;earlier_flight_end:string|null;earlier_first:string|null;earlier_last:string|null };
export async function shiftTasks(db:D1Database,user:ApplicationUser,shiftId:string,now=new Date()) {
  const shift=await db.prepare(`SELECT s.id,s.starts_at,s.ends_at,s.status FROM duty_ops_shifts s
    JOIN duty_ops_effective_assignments a ON a.shift_id=s.id WHERE s.id=? AND a.user_id=?`).bind(shiftId,user.id)
    .first<{id:string;starts_at:string;ends_at:string;status:string}>();
  if(!shift) throw new ApplicationError('Duty Ops shift not found.',404);
  if(shift.status==='CANCELLED') return {shift:{id:shift.id,startsAt:shift.starts_at,endsAt:shift.ends_at},tasks:[] as Task[]};
  const rows=await db.prepare(`SELECT r.*,f.flight_starts_at,f.aircraft_callsign,f.aircraft_model,
    u.flightlogger_first_name first_name,u.flightlogger_last_name last_name,
    e.flight_ends_at earlier_flight_end,e.ends_at earlier_end,
    eu.flightlogger_first_name earlier_first,eu.flightlogger_last_name earlier_last
    FROM fuel_requests r JOIN flights f ON f.id=r.flight_id JOIN users u ON u.id=r.requested_by_user_id
    LEFT JOIN flights e ON e.id=(SELECT x.id FROM flights x WHERE x.flightlogger_aircraft_id=f.flightlogger_aircraft_id
      AND x.id<>f.id AND x.status<>'CANCELLED' AND COALESCE(x.flight_ends_at,x.ends_at)<=f.flight_starts_at
      ORDER BY COALESCE(x.flight_ends_at,x.ends_at) DESC LIMIT 1)
    LEFT JOIN flight_students es ON es.flight_id=e.id AND es.user_id=(SELECT MIN(user_id) FROM flight_students WHERE flight_id=e.id)
    LEFT JOIN users eu ON eu.id=es.user_id
    WHERE r.status='PENDING' AND f.status='OPEN' AND f.departure_airport_id='2953'
      AND r.flightlogger_aircraft_id_snapshot=f.flightlogger_aircraft_id AND f.flight_starts_at IS NOT NULL
      AND ((unixepoch(f.flight_starts_at)-3600>=unixepoch(?) AND unixepoch(f.flight_starts_at)-3600<unixepoch(?))
        OR (unixepoch(f.flight_starts_at)>=unixepoch(?) AND unixepoch(f.flight_starts_at)<unixepoch(?))
        OR (unixepoch(?)>=unixepoch(?) AND unixepoch(f.flight_starts_at)-3600<unixepoch(?)))
    ORDER BY f.flight_starts_at,r.id LIMIT 100`).bind(shift.starts_at,shift.ends_at,shift.starts_at,shift.ends_at,
      now.toISOString(),shift.starts_at,shift.starts_at).all<TaskRow>();
  const tasks=rows.results.map(r=>({id:r.id,flightId:r.flight_id,flightStartsAt:r.flight_starts_at,
    attentionFrom:new Date(Date.parse(r.flight_starts_at)-3600_000).toISOString(),
    aircraft:{id:r.flightlogger_aircraft_id_snapshot,callSign:r.aircraft_callsign,model:r.aircraft_model},
    pilot:[r.first_name,r.last_name].filter(Boolean).join(' ')||'Student',
    requested:r.request_kind==='PRESET'?r.preset_label_snapshot??'Fuel':`${r.quantity_value} ${r.quantity_unit}`,
    status:r.status,earlierFlight:r.earlier_end?{endsAt:r.earlier_flight_end??r.earlier_end,
      timeSource:r.earlier_flight_end?'flight' as const:'booking' as const,
      pilot:[r.earlier_first,r.earlier_last].filter(Boolean).join(' ')||null}:null}));
  return {shift:{id:shift.id,startsAt:shift.starts_at,endsAt:shift.ends_at},tasks};
}
export async function completeFuel(db:D1Database,user:ApplicationUser,shiftId:string,requestId:string,now=new Date()) {
  const stamp=now.toISOString();
  const membership=`EXISTS(SELECT 1 FROM duty_ops_shifts s JOIN duty_ops_effective_assignments a ON a.shift_id=s.id
    JOIN effective_user_permissions p ON p.user_id=a.user_id AND p.permission_key='duty_ops.view'
    JOIN flights f ON f.id=r.flight_id WHERE s.id=? AND a.user_id=? AND s.status<>'CANCELLED'
      AND ((unixepoch(f.flight_starts_at)-3600>=unixepoch(s.starts_at) AND unixepoch(f.flight_starts_at)-3600<unixepoch(s.ends_at))
        OR (unixepoch(f.flight_starts_at)>=unixepoch(s.starts_at) AND unixepoch(f.flight_starts_at)<unixepoch(s.ends_at))
        OR (unixepoch(?)>=unixepoch(s.starts_at) AND unixepoch(f.flight_starts_at)-3600<unixepoch(s.starts_at))))`;
  try {
    await db.batch([
      db.prepare(`UPDATE fuel_requests AS r SET status='COMPLETED',completed_at=?,completed_by_user_id=?,updated_at=?
        WHERE r.id=? AND r.status='PENDING' AND ${membership} AND EXISTS
        (SELECT 1 FROM flights f WHERE f.id=r.flight_id AND f.status='OPEN' AND f.departure_airport_id='2953'
          AND f.flightlogger_aircraft_id=r.flightlogger_aircraft_id_snapshot)`)
        .bind(stamp,user.id,stamp,requestId,shiftId,user.id,stamp),
      guard(db),
      db.prepare(`INSERT INTO fuel_request_events(id,fuel_request_id,actor_user_id,type,created_at,aircraft_id_snapshot,request_label_snapshot)
        SELECT ?,id,?,'REQUEST_COMPLETED',?,flightlogger_aircraft_id_snapshot,preset_label_snapshot FROM fuel_requests WHERE id=?`)
        .bind(crypto.randomUUID(),user.id,stamp,requestId),
    ]);
  } catch { throw conflict(); }
  return {status:'COMPLETED' as const,completedAt:stamp,
    completedBy:[user.flightlogger_first_name,user.flightlogger_last_name].filter(Boolean).join(' ')||'Duty Ops student'};
}
