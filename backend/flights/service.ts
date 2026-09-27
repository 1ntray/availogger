import { ApplicationError } from '../application-error';
import { FlightLoggerClient, FlightLoggerError } from '../flightlogger/client';
import type { StudentFlight } from '../flightlogger/flights';
import type { ApplicationUser } from '../users';
import type { FlightWindow } from './window';

export const FLIGHT_TTL_MS = 5*60_000;
const tokenHash=async(token:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(b=>b.toString(16).padStart(2,'0')).join('');
type SyncRow={window_from:string;window_to:string;token_hash:string;last_synced_at:string};
export type FlightRow={id:string;flightlogger_booking_id:string;booking_type:string;starts_at:string;ends_at:string;flight_starts_at:string|null;flight_ends_at:string|null;status:string;
  flightlogger_aircraft_id:string|null;aircraft_callsign:string|null;aircraft_model:string|null;aircraft_class:string|null;aircraft_type:string|null;fuel_coefficient_measurement:string|null;
  departure_airport_id:string|null;departure_airport_name:string|null;arrival_airport_id:string|null;arrival_airport_name:string|null;
  instructor_first_name:string|null;instructor_last_name:string|null};
export type FuelRow={id:string;flight_id:string;status:string;request_kind:string;fuel_profile_id:string|null;preset_key:string|null;preset_label_snapshot:string|null;
  quantity_value:number|null;quantity_unit:string|null;review_reason:string|null;flightlogger_aircraft_id_snapshot:string;completed_at:string|null;
  completed_by_user_id:string|null;created_at:string;updated_at:string};
const pending=new WeakMap<D1Database,Map<string,Promise<FlightResponse>>>();
export type FlightResponse={from:string;to:string;timeZone:'Europe/Oslo';sync:{lastSyncedAt:string;stale:boolean;warning:string|null};flights: (ReturnType<typeof presentFlight>)[]};
export type Profile={id:string;name:string;presets:{key:string;label:string}[]};
const eligibleSource=(f:FlightRow,now=Date.now())=>f.status==='OPEN'&&!!f.flight_starts_at&&!!f.flightlogger_aircraft_id&&f.aircraft_class!=='SIMULATOR'&&f.departure_airport_id==='2953'&&Date.parse(f.ends_at)>now;
export { eligibleSource };
const normalized=(s:string|null)=>s?.toUpperCase().replace(/[^A-Z0-9]/g,'')??'';
export async function fuelProfile(db:D1Database,flight:FlightRow):Promise<Profile|null>{
  if (!flight.flightlogger_aircraft_id||flight.aircraft_class==='SIMULATOR') return null;
  const row=await db.prepare(`SELECT p.id,p.name FROM fuel_profile_matchers m JOIN fuel_profiles p ON p.id=m.profile_id
    WHERE p.active=1 AND ((m.matcher_type='AIRCRAFT_ID' AND m.matcher_value=?) OR
      (m.matcher_type='CALLSIGN' AND m.matcher_value=?) OR (m.matcher_type='MODEL' AND m.matcher_value=?))
    ORDER BY m.priority DESC,m.id LIMIT 1`).bind(flight.flightlogger_aircraft_id,normalized(flight.aircraft_callsign),normalized(flight.aircraft_model)).first<{id:string;name:string}>();
  if(!row)return null;
  const {results}=await db.prepare('SELECT key,label FROM fuel_presets WHERE profile_id=? ORDER BY sort_order,id').bind(row.id).all<{key:string;label:string}>();
  return {...row,presets:results};
}
function presentFlight(row:FlightRow,request:FuelRow|null,profile:Profile|null){return {
  id:row.id,bookingType:row.booking_type,startsAt:row.starts_at,endsAt:row.ends_at,flightStartsAt:row.flight_starts_at,flightEndsAt:row.flight_ends_at,status:row.status,
  aircraft:row.flightlogger_aircraft_id?{id:row.flightlogger_aircraft_id,callSign:row.aircraft_callsign,model:row.aircraft_model,aircraftClass:row.aircraft_class,
    aircraftType:row.aircraft_type,fuelCoefficientMeasurement:row.fuel_coefficient_measurement}:null,
  departureAirport:row.departure_airport_id?{id:row.departure_airport_id,name:row.departure_airport_name}:null,
  arrivalAirport:row.arrival_airport_id?{id:row.arrival_airport_id,name:row.arrival_airport_name}:null,
  instructor:[row.instructor_first_name,row.instructor_last_name].filter(Boolean).join(' ')||null,
  canOrder:eligibleSource(row),profile,request:request&&{id:request.id,status:request.status,requestKind:request.request_kind,
    presetLabel:request.preset_label_snapshot,quantityValue:request.quantity_value,quantityUnit:request.quantity_unit,
    reviewReason:request.review_reason,completedAt:request.completed_at,
    // Never claim the new aircraft was fueled after an upstream replacement.
    appliesToCurrentAircraft:request.flightlogger_aircraft_id_snapshot===row.flightlogger_aircraft_id&&request.status==='COMPLETED'}
};}
const canonical=(f:StudentFlight)=>({id:crypto.randomUUID(),bookingId:f.id,type:f.bookingType,starts:f.startsAt,ends:f.endsAt,flightStarts:f.flightStartsAt,flightEnds:f.flightEndsAt,status:f.status,
  aircraftId:f.aircraft?.id??null,callsign:f.aircraft?.callSign??null,model:f.aircraft?.model??null,aircraftClass:f.aircraft?.aircraftClass??null,
  aircraftType:f.aircraft?.aircraftType??null,fuelMeasurement:f.aircraft?.fuelCoefficientMeasurement??null,
  departureId:f.departureAirport?.id??null,departureName:f.departureAirport?.name??null,arrivalId:f.arrivalAirport?.id??null,arrivalName:f.arrivalAirport?.name??null,
  instructorId:f.instructor?.id??null,instructorFirst:f.instructor?.firstName??null,instructorLast:f.instructor?.lastName??null});

export async function saveOwnFlights(db:D1Database,user:ApplicationUser,flights:StudentFlight[],window:FlightWindow,stamp:string,hash:string){
  const own=flights.filter(f=>f.studentIds.includes(user.flightlogger_user_id!));
  const rows=own.map(canonical),ids=JSON.stringify(own.map(f=>f.id));
  const current=`EXISTS(SELECT 1 FROM users u JOIN flightlogger_credentials c ON c.user_id=u.id WHERE u.id=? AND u.flightlogger_user_id=? AND c.updated_at<=?)`;
  const changed=`(r.flightlogger_aircraft_id_snapshot IS NOT flights.flightlogger_aircraft_id OR flights.departure_airport_id IS NOT '2953')`;
  await db.batch([
    // A credential replacement or older concurrent result aborts all writes.
    db.prepare(`UPDATE fuel_request_state SET revision=CASE WHEN ${current} AND
      NOT EXISTS(SELECT 1 FROM flight_sync_state WHERE user_id=? AND last_synced_at>?) THEN revision+1 ELSE -1 END WHERE id=1`)
      .bind(user.id,user.flightlogger_user_id,stamp,user.id,stamp),
    db.prepare(`INSERT INTO flights(id,flightlogger_booking_id,booking_type,starts_at,ends_at,flight_starts_at,flight_ends_at,status,
      flightlogger_aircraft_id,aircraft_callsign,aircraft_model,aircraft_class,aircraft_type,fuel_coefficient_measurement,
      departure_airport_id,departure_airport_name,arrival_airport_id,arrival_airport_name,instructor_flightlogger_id,instructor_first_name,instructor_last_name,last_synced_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.bookingId'),json_extract(value,'$.type'),json_extract(value,'$.starts'),json_extract(value,'$.ends'),
        json_extract(value,'$.flightStarts'),json_extract(value,'$.flightEnds'),json_extract(value,'$.status'),json_extract(value,'$.aircraftId'),
        json_extract(value,'$.callsign'),json_extract(value,'$.model'),json_extract(value,'$.aircraftClass'),json_extract(value,'$.aircraftType'),
        json_extract(value,'$.fuelMeasurement'),json_extract(value,'$.departureId'),json_extract(value,'$.departureName'),
        json_extract(value,'$.arrivalId'),json_extract(value,'$.arrivalName'),json_extract(value,'$.instructorId'),
        json_extract(value,'$.instructorFirst'),json_extract(value,'$.instructorLast'),? FROM json_each(?) WHERE 1
      ON CONFLICT(flightlogger_booking_id) DO UPDATE SET booking_type=excluded.booking_type,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
        flight_starts_at=excluded.flight_starts_at,flight_ends_at=excluded.flight_ends_at,status=excluded.status,
        flightlogger_aircraft_id=excluded.flightlogger_aircraft_id,aircraft_callsign=excluded.aircraft_callsign,aircraft_model=excluded.aircraft_model,
        aircraft_class=excluded.aircraft_class,aircraft_type=excluded.aircraft_type,fuel_coefficient_measurement=excluded.fuel_coefficient_measurement,
        departure_airport_id=excluded.departure_airport_id,departure_airport_name=excluded.departure_airport_name,
        arrival_airport_id=excluded.arrival_airport_id,arrival_airport_name=excluded.arrival_airport_name,
        instructor_flightlogger_id=excluded.instructor_flightlogger_id,instructor_first_name=excluded.instructor_first_name,
        instructor_last_name=excluded.instructor_last_name,last_synced_at=excluded.last_synced_at
      WHERE flights.last_synced_at<=excluded.last_synced_at`).bind(stamp,JSON.stringify(rows)),
    db.prepare(`INSERT INTO fuel_request_events SELECT lower(hex(randomblob(16))),r.id,NULL,'NEEDS_REVIEW_SET',?,r.flightlogger_aircraft_id_snapshot,r.preset_label_snapshot
      FROM fuel_requests r JOIN flights ON flights.id=r.flight_id WHERE flights.status<>'CANCELLED' AND r.status IN ('PENDING','COMPLETED') AND ${changed}`).bind(stamp),
    db.prepare(`UPDATE fuel_requests AS f SET status='NEEDS_REVIEW',review_reason=CASE WHEN f.flightlogger_aircraft_id_snapshot IS NOT
      (SELECT flightlogger_aircraft_id FROM flights WHERE id=f.flight_id) THEN 'AIRCRAFT_CHANGED' ELSE 'DEPARTURE_CHANGED' END,updated_at=?
      WHERE status IN ('PENDING','COMPLETED') AND EXISTS(SELECT 1 FROM flights WHERE id=f.flight_id AND flights.status<>'CANCELLED' AND
      (f.flightlogger_aircraft_id_snapshot IS NOT flights.flightlogger_aircraft_id OR flights.departure_airport_id IS NOT '2953'))`).bind(stamp),
    db.prepare(`INSERT INTO fuel_request_events SELECT lower(hex(randomblob(16))),r.id,NULL,'FLIGHT_CANCELLED',?,r.flightlogger_aircraft_id_snapshot,r.preset_label_snapshot
      FROM fuel_requests r JOIN flights f ON f.id=r.flight_id WHERE r.status='PENDING' AND f.status='CANCELLED'`).bind(stamp),
    db.prepare(`UPDATE fuel_requests SET status='CANCELLED',cancelled_at=?,updated_at=? WHERE status='PENDING' AND
      flight_id IN(SELECT id FROM flights WHERE status='CANCELLED')`).bind(stamp,stamp),
    db.prepare(`DELETE FROM flight_students WHERE user_id=? AND last_seen_at<=? AND flight_id IN
      (SELECT id FROM flights WHERE starts_at<? AND ends_at>? AND flightlogger_booking_id NOT IN(SELECT value FROM json_each(?)))`)
      .bind(user.id,stamp,window.endsAt,window.startsAt,ids),
    db.prepare(`INSERT INTO flight_students SELECT id,?,? FROM flights WHERE flightlogger_booking_id IN(SELECT value FROM json_each(?))
      ON CONFLICT(flight_id,user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at WHERE flight_students.last_seen_at<=excluded.last_seen_at`)
      .bind(user.id,stamp,ids),
    db.prepare(`INSERT INTO flight_sync_state VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET window_from=excluded.window_from,
      window_to=excluded.window_to,token_hash=excluded.token_hash,last_synced_at=excluded.last_synced_at`)
      .bind(user.id,window.startsAt,window.endsAt,hash,stamp),
    db.prepare(`DELETE FROM flights WHERE starts_at<? AND ends_at>? AND last_synced_at<=? AND
      NOT EXISTS(SELECT 1 FROM flight_students s WHERE s.flight_id=flights.id) AND
      NOT EXISTS(SELECT 1 FROM fuel_requests r WHERE r.flight_id=flights.id)`)
      .bind(window.endsAt,window.startsAt,stamp),
  ]);
}

async function readOwn(db:D1Database,user:ApplicationUser,window:FlightWindow,stale:boolean,warning:string|null,state:SyncRow):Promise<FlightResponse>{
  const {results}=await db.prepare(`SELECT f.* FROM flights f JOIN flight_students s ON s.flight_id=f.id
    WHERE s.user_id=? AND f.starts_at<? AND f.ends_at>? ORDER BY f.flight_starts_at,f.id`).bind(user.id,window.endsAt,window.startsAt).all<FlightRow>();
  const [requests,profiles,matchers,presets]=await db.batch([
    db.prepare("SELECT * FROM fuel_requests WHERE status<>'CANCELLED' AND flight_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(results.map(r=>r.id))),
    db.prepare('SELECT id,name FROM fuel_profiles WHERE active=1'),
    db.prepare('SELECT profile_id,matcher_type,matcher_value,priority FROM fuel_profile_matchers ORDER BY priority DESC,id'),
    db.prepare('SELECT profile_id,key,label FROM fuel_presets ORDER BY sort_order,id'),
  ]);
  const requestByFlight=new Map((requests.results as FuelRow[]).map(r=>[r.flight_id,r]));
  type ProfileRow={id:string;name:string};type Matcher={profile_id:string;matcher_type:string;matcher_value:string};
  type Preset={profile_id:string;key:string;label:string};
  const profileById=new Map((profiles.results as ProfileRow[]).map(p=>[p.id,p]));
  const presetByProfile=new Map<string,Profile['presets']>();
  for(const p of presets.results as Preset[]){const group=presetByProfile.get(p.profile_id)??[];group.push({key:p.key,label:p.label});presetByProfile.set(p.profile_id,group);}
  const flights=results.map(row=>{
    const match=(matchers.results as Matcher[]).find(m=>profileById.has(m.profile_id)&&row.aircraft_class!=='SIMULATOR'&&
      ((m.matcher_type==='AIRCRAFT_ID'&&m.matcher_value===row.flightlogger_aircraft_id)||
       (m.matcher_type==='CALLSIGN'&&m.matcher_value===normalized(row.aircraft_callsign))||
       (m.matcher_type==='MODEL'&&m.matcher_value===normalized(row.aircraft_model))));
    const profile=match?profileById.get(match.profile_id):null;
    return presentFlight(row,requestByFlight.get(row.id)??null,profile?{...profile,presets:presetByProfile.get(profile.id)??[]}:null);
  });
  return {from:window.from,to:window.to,timeZone:'Europe/Oslo',sync:{lastSyncedAt:state.last_synced_at,stale,warning},flights};
}
async function sync(db:D1Database,user:ApplicationUser,token:string,window:FlightWindow,hash:string,maxRequests:number){
  let state=await db.prepare('SELECT * FROM flight_sync_state WHERE user_id=? AND token_hash=?').bind(user.id,hash).first<SyncRow>();
  let failure:unknown;
  if(!state||state.window_from>window.startsAt||state.window_to<window.endsAt||Date.now()-Date.parse(state.last_synced_at)>=FLIGHT_TTL_MS){
    const stamp=new Date().toISOString(),client=new FlightLoggerClient(token,undefined,maxRequests);
    try{
      const profile=await client.currentUserProfile();
      if(profile.id!==user.flightlogger_user_id) throw new ApplicationError('Reconnect your FlightLogger key in Settings.',409);
      const records=await client.flights(window.startsAt,window.endsAt);
      await saveOwnFlights(db,user,records,window,stamp,hash);
    }catch(cause){failure=cause;}
  }
  state=await db.prepare('SELECT * FROM flight_sync_state WHERE user_id=? AND token_hash=?').bind(user.id,hash).first<SyncRow>();
  if(!state||state.window_from>=window.endsAt||state.window_to<=window.startsAt){
    if(failure instanceof FlightLoggerError && failure.status===429) throw new ApplicationError('FlightLogger is rate limiting flights. Try again shortly.',429,undefined,failure.retryAfterSeconds);
    throw new ApplicationError('Flights could not be synchronized. Check FlightLogger in Settings.',503);
  }
  const stale=!!failure||Date.now()-Date.parse(state.last_synced_at)>=FLIGHT_TTL_MS||state.window_from>window.startsAt||state.window_to<window.endsAt;
  return readOwn(db,user,window,stale,failure?'Refresh failed. Showing previously synchronized flights.':null,state);
}
export async function loadFlights(db:D1Database,user:ApplicationUser,token:string,window:FlightWindow,maxRequests=20):Promise<FlightResponse>{
  const hash=await tokenHash(token),key=`${user.id}:${hash}:${window.startsAt}:${window.endsAt}`;
  let map=pending.get(db);if(!map){map=new Map();pending.set(db,map);} const existing=map.get(key);if(existing)return existing;
  const work=sync(db,user,token,window,hash,maxRequests);if(map.size<128)map.set(key,work);
  try{return await work;}finally{if(map.get(key)===work)map.delete(key);}
}
