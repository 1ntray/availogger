import type { FlightWindow } from './window';

// All statements run inside saveOwnFlights' D1 batch. The event comparison must
// precede the canonical upsert; membership additions/removals follow it.
type Field = { name:string; oldValue:string; newValue:string; changed:string; oldLabel?:string; newLabel?:string;
  oldDetail?:string; newDetail?:string };
const incoming=(key:string)=>`json_extract(j.value,'$.${key}')`;
const different=(oldValue:string,newValue:string)=>`${oldValue} IS NOT ${newValue}`;
const instructorName=(first:string,last:string)=>`NULLIF(trim(coalesce(${first},'') || ' ' || coalesce(${last},'')),'')`;
const fields:Field[]=[
  {name:'FLIGHT_START',oldValue:'f.flight_starts_at',newValue:incoming('flightStarts'),changed:different('f.flight_starts_at',incoming('flightStarts'))},
  {name:'FLIGHT_END',oldValue:'f.flight_ends_at',newValue:incoming('flightEnds'),changed:different('f.flight_ends_at',incoming('flightEnds'))},
  {name:'BOOKING_START',oldValue:'f.starts_at',newValue:incoming('starts'),changed:different('f.starts_at',incoming('starts'))},
  {name:'BOOKING_END',oldValue:'f.ends_at',newValue:incoming('ends'),changed:different('f.ends_at',incoming('ends'))},
  {name:'AIRCRAFT',oldValue:'f.flightlogger_aircraft_id',newValue:incoming('aircraftId'),
    changed:`(${different('f.flightlogger_aircraft_id',incoming('aircraftId'))} OR ${different('f.aircraft_callsign',incoming('callsign'))})`,
    oldLabel:'coalesce(f.aircraft_callsign,f.aircraft_model,f.flightlogger_aircraft_id)',
    newLabel:`coalesce(${incoming('callsign')},${incoming('model')},${incoming('aircraftId')})`,
    oldDetail:'f.aircraft_model',newDetail:incoming('model')},
  {name:'INSTRUCTOR',oldValue:'f.instructor_flightlogger_id',newValue:incoming('instructorId'),
    changed:different('f.instructor_flightlogger_id',incoming('instructorId')),
    oldLabel:instructorName('f.instructor_first_name','f.instructor_last_name'),
    newLabel:instructorName(incoming('instructorFirst'),incoming('instructorLast'))},
  {name:'DEPARTURE_AIRPORT',oldValue:'f.departure_airport_id',newValue:incoming('departureId'),
    changed:different('f.departure_airport_id',incoming('departureId')),
    oldLabel:'coalesce(f.departure_airport_name,f.departure_airport_id)',newLabel:`coalesce(${incoming('departureName')},${incoming('departureId')})`},
  {name:'ARRIVAL_AIRPORT',oldValue:'f.arrival_airport_id',newValue:incoming('arrivalId'),
    changed:different('f.arrival_airport_id',incoming('arrivalId')),
    oldLabel:'coalesce(f.arrival_airport_name,f.arrival_airport_id)',newLabel:`coalesce(${incoming('arrivalName')},${incoming('arrivalId')})`},
  {name:'STATUS',oldValue:'f.status',newValue:incoming('status'),
    changed:`((f.status='CANCELLED') IS NOT (${incoming('status')}='CANCELLED'))`},
];
const changed=fields.map(field=>field.changed).join(' OR ');
const flightJoin=`FROM json_each(?) j JOIN flights f ON f.flightlogger_booking_id=${incoming('bookingId')}`;

export function beforeFlightUpsert(db:D1Database,rowsJson:string,stamp:string):D1PreparedStatement[]{
  const event=db.prepare(`INSERT INTO flight_change_events(id,flight_id,flightlogger_booking_id,type,subject_user_id,detected_at,
    starts_at_snapshot,ends_at_snapshot,flight_starts_at_snapshot,flight_ends_at_snapshot,aircraft_callsign_snapshot,
    aircraft_model_snapshot,status_snapshot)
    SELECT ${incoming('changeEventId')},f.id,f.flightlogger_booking_id,
      CASE WHEN f.status<>'CANCELLED' AND ${incoming('status')}='CANCELLED' THEN 'CANCELLED'
        WHEN f.status='CANCELLED' AND ${incoming('status')}<>'CANCELLED' THEN 'RESTORED' ELSE 'CHANGED' END,
      NULL,?,${incoming('starts')},${incoming('ends')},${incoming('flightStarts')},${incoming('flightEnds')},
      ${incoming('callsign')},${incoming('model')},${incoming('status')}
    ${flightJoin} WHERE f.last_synced_at<=? AND EXISTS(SELECT 1 FROM flight_students s WHERE s.flight_id=f.id)
      AND (${changed})`).bind(stamp,rowsJson,stamp);
  const itemJson=fields.map(field=>`json_object('field','${field.name}','oldValue',${field.oldValue},
    'newValue',${field.newValue},'oldLabel',${field.oldLabel??'NULL'},'newLabel',${field.newLabel??'NULL'},
    'oldDetail',${field.oldDetail??'NULL'},'newDetail',${field.newDetail??'NULL'},'different',(${field.changed}))`).join(',');
  const items=db.prepare(`INSERT INTO flight_change_items(event_id,field,old_value,new_value,old_label,new_label,old_detail,new_detail)
    SELECT e.id,json_extract(c.value,'$.field'),json_extract(c.value,'$.oldValue'),json_extract(c.value,'$.newValue'),
      json_extract(c.value,'$.oldLabel'),json_extract(c.value,'$.newLabel'),json_extract(c.value,'$.oldDetail'),
      json_extract(c.value,'$.newDetail')
    ${flightJoin} JOIN flight_change_events e ON e.id=${incoming('changeEventId')}
    CROSS JOIN json_each(json_array(${itemJson})) c WHERE json_extract(c.value,'$.different')=1`).bind(rowsJson);
  const inbox=db.prepare(`INSERT INTO user_inbox_items(id,user_id,kind,source_type,source_id,created_at,read_at)
    SELECT lower(hex(randomblob(16))),s.user_id,'FLIGHT_CHANGE','FLIGHT_CHANGE',e.id,?,NULL
    FROM json_each(?) j JOIN flight_change_events e ON e.id=${incoming('changeEventId')}
    JOIN flight_students s ON s.flight_id=e.flight_id`).bind(stamp,rowsJson);
  return [event,items,inbox];
}

export function membershipChangeStatements(db:D1Database,userId:string,hash:string,rowsJson:string,idsJson:string,
  window:FlightWindow,stamp:string):D1PreparedStatement[]{
  // The prior successful window is the observation baseline. Only its overlap
  // with this complete result may produce additions or removals.
  const overlap=`f.starts_at<min(ss.window_to,?) AND f.ends_at>max(ss.window_from,?)`;
  const state=`JOIN flight_sync_state ss ON ss.user_id=? AND ss.token_hash=? AND ss.last_synced_at<=?`;
  const added=db.prepare(`INSERT INTO flight_change_events(id,flight_id,flightlogger_booking_id,type,subject_user_id,detected_at,
    starts_at_snapshot,ends_at_snapshot,flight_starts_at_snapshot,flight_ends_at_snapshot,aircraft_callsign_snapshot,
    aircraft_model_snapshot,status_snapshot)
    SELECT ${incoming('addedEventId')},f.id,f.flightlogger_booking_id,'FLIGHT_ADDED',?, ?,f.starts_at,f.ends_at,
      f.flight_starts_at,f.flight_ends_at,f.aircraft_callsign,f.aircraft_model,f.status
    FROM json_each(?) j JOIN flights f ON f.flightlogger_booking_id=${incoming('bookingId')} ${state}
    WHERE ${overlap} AND NOT EXISTS(SELECT 1 FROM flight_students s WHERE s.user_id=? AND s.flight_id=f.id)`)
    .bind(userId,stamp,rowsJson,userId,hash,stamp,window.endsAt,window.startsAt,userId);
  const addedInbox=db.prepare(`INSERT INTO user_inbox_items(id,user_id,kind,source_type,source_id,created_at,read_at)
    SELECT lower(hex(randomblob(16))),?,'FLIGHT_CHANGE','FLIGHT_CHANGE',e.id,?,NULL
    FROM json_each(?) j JOIN flight_change_events e ON e.id=${incoming('addedEventId')}`)
    .bind(userId,stamp,rowsJson);
  const removed=db.prepare(`INSERT INTO flight_change_events(id,flight_id,flightlogger_booking_id,type,subject_user_id,detected_at,
    starts_at_snapshot,ends_at_snapshot,flight_starts_at_snapshot,flight_ends_at_snapshot,aircraft_callsign_snapshot,
    aircraft_model_snapshot,status_snapshot)
    SELECT lower(hex(randomblob(16))),f.id,f.flightlogger_booking_id,'FLIGHT_REMOVED',?, ?,f.starts_at,f.ends_at,
      f.flight_starts_at,f.flight_ends_at,f.aircraft_callsign,f.aircraft_model,f.status
    FROM flight_students s JOIN flights f ON f.id=s.flight_id ${state}
    WHERE s.user_id=? AND s.last_seen_at<=? AND ${overlap}
      AND f.flightlogger_booking_id NOT IN(SELECT value FROM json_each(?))`)
    .bind(userId,stamp,userId,hash,stamp,userId,stamp,window.endsAt,window.startsAt,idsJson);
  const removedInbox=db.prepare(`INSERT INTO user_inbox_items(id,user_id,kind,source_type,source_id,created_at,read_at)
    SELECT lower(hex(randomblob(16))),?,'FLIGHT_CHANGE','FLIGHT_CHANGE',e.id,?,NULL
    FROM flight_change_events e WHERE e.type='FLIGHT_REMOVED' AND e.subject_user_id=? AND e.detected_at=?
      AND NOT EXISTS(SELECT 1 FROM user_inbox_items i WHERE i.user_id=? AND i.source_type='FLIGHT_CHANGE' AND i.source_id=e.id)`)
    .bind(userId,stamp,userId,stamp,userId);
  return [added,addedInbox,removed,removedInbox];
}
