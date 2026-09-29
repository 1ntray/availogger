import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { applyTestMigration,createTestDatabase,seedCredential,testEncryptionKey } from './d1-fixture';
import { loadFlights,saveOwnFlights } from '../backend/flights/service';
import { FlightLoggerClient,FlightLoggerError } from '../backend/flightlogger/client';
import { flightWindow } from '../backend/flights/window';
import { inboxEndpoint,markInboxReadEndpoint,listInbox } from '../backend/inbox';
import type { StudentFlight } from '../backend/flightlogger/flights';
import type { ApplicationUser } from '../backend/users';
import { getEffectivePermissions } from '../backend/authorization';

const now=new Date('2026-09-28T08:00:00.000Z');
const at=(hours:number)=>new Date(now.getTime()+hours*3600_000).toISOString();
const window=flightWindow(new URL('https://portal.test/api/flights'),now);
const flight=(id='booking-1'):StudentFlight=>({id,bookingType:'SingleStudentBooking',startsAt:at(48),endsAt:at(50),
  flightStartsAt:at(48),flightEndsAt:at(49),status:'OPEN',aircraft:{id:'aircraft-1',callSign:'LN-UPT',model:'Z242L',
    aircraftClass:'AIRPLANE',aircraftType:null,fuelCoefficientMeasurement:null},
  instructor:{id:'instructor-1',firstName:'Anna',lastName:'Olsen'},
  departureAirport:{id:'2953',name:'Bardufoss'},arrivalAirport:{id:'arrival-1',name:'Tromsø'},studentIds:['fl-alice']});

describe('flight changes and personal Inbox',()=>{
  let fixture:Awaited<ReturnType<typeof createTestDatabase>>,db:D1Database,alice:ApplicationUser,bob:ApplicationUser;
  const sync=(user:ApplicationUser,records:StudentFlight[],offset:number,w=window)=>
    saveOwnFlights(db,user,records,w,at(offset),user.id+'-hash');
  const count=(table:string)=>db.prepare(`SELECT count(*) n FROM ${table}`).first<number>('n');
  beforeEach(async()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
    fixture=await createTestDatabase();db=fixture.db;
    alice=await seedCredential(db,'alice','test-alice','alice@example.test','fl-alice');
    bob=await seedCredential(db,'bob','test-bob','bob@example.test','fl-bob');
  });
  afterEach(async()=>{vi.restoreAllMocks();vi.useRealTimers();await fixture.dispose();});

  it('makes initial synchronization a baseline and ignores identical refreshes and routine completion',async()=>{
    await sync(alice,[flight(),flight('booking-2')],1);
    expect(await count('flights')).toBe(2);
    await sync(alice,[flight(),flight('booking-2')],2);
    await sync(alice,[{...flight(),status:'COMPLETED'},flight('booking-2')],3);
    await sync(alice,[{...flight(),status:'COMPLETED',aircraft:{...flight().aircraft!,model:'Zlin Z242L'},
      instructor:{...flight().instructor!,firstName:'Anne'}},flight('booking-2')],4);
    expect(await count('flight_change_events')).toBe(0);
    expect(await count('user_inbox_items')).toBe(0);
  },20000);
  it('groups time, aircraft, instructor and airport updates in one immutable event while fuel moves to review',async()=>{
    await sync(alice,[flight()],1);
    const flightId=await db.prepare("SELECT id FROM flights WHERE flightlogger_booking_id='booking-1'").first<string>('id');
    await db.prepare(`INSERT INTO fuel_requests(id,flight_id,requested_by_user_id,status,request_kind,quantity_value,quantity_unit,
      flightlogger_booking_id,flightlogger_aircraft_id_snapshot,departure_airport_id_snapshot,created_at,updated_at)
      VALUES(?,?,?,'PENDING','QUANTITY',40,'L','booking-1','aircraft-1','2953',?,?)`)
      .bind(crypto.randomUUID(),flightId,alice.id,at(1),at(1)).run();
    const changed={...flight(),startsAt:at(52),endsAt:at(54),flightStartsAt:at(52),flightEndsAt:at(53),
      aircraft:{...flight().aircraft!,id:'aircraft-2',callSign:'LN-TRB',model:'C182T'},
      instructor:{id:'instructor-2',firstName:'Erik',lastName:'Hansen'},
      arrivalAirport:{id:'arrival-2',name:'Narvik'}};
    await sync(alice,[changed],2);
    expect(await count('flight_change_events')).toBe(1);
    const fields=(await db.prepare('SELECT field FROM flight_change_items ORDER BY field').all<{field:string}>()).results.map(r=>r.field);
    expect(fields).toEqual(['AIRCRAFT','ARRIVAL_AIRPORT','BOOKING_END','BOOKING_START','FLIGHT_END','FLIGHT_START','INSTRUCTOR']);
    const aircraft=await db.prepare("SELECT old_value,new_value,old_label,new_label,old_detail,new_detail FROM flight_change_items WHERE field='AIRCRAFT'").first<any>();
    expect(aircraft).toMatchObject({old_value:'aircraft-1',new_value:'aircraft-2',old_label:'LN-UPT',new_label:'LN-TRB',old_detail:'Z242L',new_detail:'C182T'});
    expect(await db.prepare('SELECT status FROM fuel_requests').first('status')).toBe('NEEDS_REVIEW');
    const inbox=await listInbox(db,alice.id,new URL('https://portal.test/api/inbox'));
    expect(inbox).toMatchObject({unreadCount:1,items:[{title:'Flight changed',flight:{startsAt:at(52),callSign:'LN-TRB'}}]});
    expect(inbox.items[0].summary).toContain('Time');
    await sync(alice,[changed],3);
    expect(await count('flight_change_events')).toBe(1);
    // State transition dedupe is not permanent: A -> B -> A -> B are three changes.
    await sync(alice,[flight()],4);await sync(alice,[changed],5);
    expect(await count('flight_change_events')).toBe(3);
    const firstPage=await listInbox(db,alice.id,new URL('https://portal.test/api/inbox?limit=1'));
    expect(firstPage.nextCursor).toBeTruthy();
    const nextPage=await listInbox(db,alice.id,new URL(`https://portal.test/api/inbox?limit=1&cursor=${firstPage.nextCursor}`));
    expect(nextPage.items).toHaveLength(1);
    expect(nextPage.items[0].id).not.toBe(firstPage.items[0].id);
  },20000);
  it('tracks cancellation and restoration but not status progression',async()=>{
    await sync(alice,[flight()],1);
    await sync(alice,[{...flight(),status:'CANCELLED'}],2);
    await sync(alice,[{...flight(),status:'OPEN'}],3);
    await sync(alice,[{...flight(),status:'PARTIALLY_COMPLETED'}],4);
    expect((await db.prepare('SELECT type FROM flight_change_events ORDER BY detected_at').all<{type:string}>()).results.map(r=>r.type))
      .toEqual(['CANCELLED','RESTORED']);
    expect((await listInbox(db,alice.id,new URL('https://portal.test/api/inbox'))).items.map(i=>i.title))
      .toEqual(['Flight restored','Flight cancelled']);
  },20000);
  it('announces additions/removals only inside the previous successful window overlap',async()=>{
    const short=flightWindow(new URL('https://portal.test/api/flights?from=2026-09-28&to=2026-10-04'),now);
    const long=flightWindow(new URL('https://portal.test/api/flights?from=2026-09-28&to=2026-11-02'),now);
    const outside={...flight('outside'),startsAt:at(24*20),endsAt:at(24*20+2),flightStartsAt:at(24*20),flightEndsAt:at(24*20+1)};
    await sync(alice,[flight()],1,short);
    await sync(alice,[flight(),outside],2,long); // New part of the window is baseline.
    expect(await count('flight_change_events')).toBe(0);
    const added=flight('new-in-overlap');
    await sync(alice,[flight(),outside,added],3,long);
    expect((await db.prepare('SELECT type FROM flight_change_events').all<{type:string}>()).results.map(r=>r.type)).toEqual(['FLIGHT_ADDED']);
    await sync(alice,[outside,added],4,long);
    expect((await db.prepare('SELECT type FROM flight_change_events ORDER BY detected_at').all<{type:string}>()).results.map(r=>r.type))
      .toEqual(['FLIGHT_ADDED','FLIGHT_REMOVED']);
    expect(await db.prepare("SELECT count(*) n FROM flight_students s JOIN flights f ON f.id=s.flight_id WHERE f.flightlogger_booking_id='booking-1'").first('n')).toBe(0);
    expect((await listInbox(db,alice.id,new URL('https://portal.test/api/inbox'))).unreadCount).toBe(2);
    expect(await db.prepare("SELECT flight_id FROM flight_change_events WHERE type='FLIGHT_REMOVED'").first('flight_id')).toBeNull();
  },20000);
  it('starts a fresh baseline after credential replacement without flooding change history',async()=>{
    await sync(alice,[flight()],1);
    await db.prepare('UPDATE flightlogger_credentials SET token_ciphertext=token_ciphertext WHERE user_id=?').bind(alice.id).run();
    expect(await count('flight_students')).toBe(0);
    expect(await count('flight_sync_state')).toBe(0);
    await sync(alice,[{...flight(),flightStartsAt:at(48.5)}],2);
    expect(await count('flight_change_events')).toBe(0);
    expect(await count('user_inbox_items')).toBe(0);
  });
  it('does not record removals or Inbox items after an upstream 429 and serves the existing snapshot as stale',async()=>{
    vi.spyOn(FlightLoggerClient.prototype,'currentUserProfile').mockResolvedValue({id:'fl-alice',firstName:null,lastName:null});
    const fetchFlights=vi.spyOn(FlightLoggerClient.prototype,'flights').mockResolvedValueOnce([flight()]);
    const first=await loadFlights(db,alice,'test-alice',window);
    expect(first.sync.stale).toBe(false);
    fetchFlights.mockRejectedValueOnce(new FlightLoggerError('Rate limited',429,60));
    vi.advanceTimersByTime(6*60_000);
    const stale=await loadFlights(db,alice,'test-alice',window);
    expect(stale.sync.stale).toBe(true);
    expect(stale.flights).toHaveLength(1);
    expect(await count('flight_change_events')).toBe(0);
    expect(await count('user_inbox_items')).toBe(0);
  },20000);
  it('keeps one shared canonical event and one personal item per independently proven student',async()=>{
    const shared={...flight(),bookingType:'MultiStudentBooking' as const,studentIds:['fl-alice','fl-bob']};
    await sync(alice,[shared],1);await sync(bob,[shared],2);
    const changed={...shared,flightStartsAt:at(48.5)};
    await Promise.all([sync(alice,[changed],3),sync(bob,[changed],4)]);
    expect(await count('flight_change_events')).toBe(1);
    expect(await count('user_inbox_items')).toBe(2);
    expect((await listInbox(db,alice.id,new URL('https://portal.test/api/inbox'))).unreadCount).toBe(1);
    expect((await listInbox(db,bob.id,new URL('https://portal.test/api/inbox'))).unreadCount).toBe(1);
  },20000);
  it('records a shared-booking removal only for the student whose proven membership disappeared',async()=>{
    const shared={...flight(),bookingType:'MultiStudentBooking' as const,studentIds:['fl-alice','fl-bob']};
    await sync(alice,[shared],1);await sync(bob,[shared],2);
    await sync(alice,[],3);
    expect((await listInbox(db,alice.id,new URL('https://portal.test/api/inbox'))).items[0].title).toBe('Flight removed from your schedule');
    expect((await listInbox(db,bob.id,new URL('https://portal.test/api/inbox'))).items).toHaveLength(0);
    expect(await count('flights')).toBe(1);
    expect(await count('flight_students')).toBe(1);
  },20000);
  it('bounds and scopes Inbox, then marks read idempotently without changing the source',async()=>{
    await sync(alice,[flight()],1);await sync(alice,[{...flight(),flightStartsAt:at(48.5)}],2);
    const item=(await listInbox(db,alice.id,new URL('https://portal.test/api/inbox'))).items[0];
    const context=(actor:ApplicationUser,path:string,method='GET',init:RequestInit={})=>({request:new Request(`https://portal.test${path}`,{method,...init}),
      env:{DB:db,FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY:testEncryptionKey},
      data:{accessIdentity:{subject:actor.access_subject,email:actor.email}},params:{itemId:item.id}});
    const own=await inboxEndpoint(context(alice,'/api/inbox?limit=1') as never);
    expect(own.status).toBe(200);expect(own.headers.get('Cache-Control')).toBe('no-store');
    expect((await own.json() as any).items).toHaveLength(1);
    expect((await inboxEndpoint(context(bob,'/api/inbox') as never)).status).toBe(200);
    expect((await inboxEndpoint(context(alice,'/api/inbox?limit=51') as never)).status).toBe(400);
    expect((await inboxEndpoint(context(alice,'/api/inbox?userId='+bob.id) as never)).status).toBe(400);
    expect((await inboxEndpoint(context(alice,'/api/inbox?cursor=broken') as never)).status).toBe(400);
    expect((await markInboxReadEndpoint(context(bob,`/api/inbox/${item.id}/read`,'POST') as never)).status).toBe(404);
    expect((await markInboxReadEndpoint(context(alice,`/api/inbox/${item.id}/read`,'POST',
      {headers:{Origin:'https://other.test'}}) as never)).status).toBe(403);
    expect((await markInboxReadEndpoint(context(alice,`/api/inbox/${item.id}/read`,'POST',
      {body:'{}'}) as never)).status).toBe(400);
    expect((await markInboxReadEndpoint({...context(alice,'/api/inbox/invalid/read','POST'),params:{itemId:'invalid'}} as never)).status).toBe(400);
    // A browser or Pages runtime can represent an empty POST as a zero-byte stream.
    const read=await markInboxReadEndpoint(context(alice,`/api/inbox/${item.id}/read`,'POST',{body:''}) as never);
    expect(read.status).toBe(200);const first=await read.json() as {readAt:string};
    const again=await markInboxReadEndpoint(context(alice,`/api/inbox/${item.id}/read`,'POST') as never);
    expect((await again.json() as {readAt:string}).readAt).toBe(first.readAt);
    expect((await listInbox(db,alice.id,new URL('https://portal.test/api/inbox'))).unreadCount).toBe(0);
    expect(await count('flight_change_events')).toBe(1);
    expect((await inboxEndpoint({request:new Request('https://portal.test/api/inbox'),env:{DB:db},data:{},params:{}} as never)).status).toBe(401);
  },20000);
});

it('migrates populated 0010 to 0011 without changing users, flights, fuel, Brakkevakt or permissions',async()=>{
  const fixture=await createTestDatabase(true,'0010_brakkevakt.sql');
  try{
    const db=fixture.db,user=await seedCredential(db,'existing','token');
    await db.prepare(`INSERT INTO flights(id,flightlogger_booking_id,booking_type,starts_at,ends_at,status,last_synced_at)
      VALUES('existing-flight','existing-booking','SingleStudentBooking',?,?,'OPEN',?)`).bind(at(48),at(50),at(1)).run();
    await db.prepare(`INSERT INTO fuel_requests(id,flight_id,requested_by_user_id,status,request_kind,quantity_value,quantity_unit,
      flightlogger_booking_id,flightlogger_aircraft_id_snapshot,departure_airport_id_snapshot,created_at,updated_at)
      VALUES('existing-fuel','existing-flight',?,'PENDING','QUANTITY',40,'L','existing-booking','aircraft-1','2953',?,?)`)
      .bind(user.id,at(1),at(1)).run();
    await db.prepare(`INSERT INTO brakkevakt_periods(id,week_start,published,created_at,created_by_user_id,updated_at,updated_by_user_id)
      VALUES('existing-week','2026-10-05',0,?,?,?,?)`).bind(at(1),user.id,at(1),user.id).run();
    const permissions=await getEffectivePermissions(db,user);
    await applyTestMigration(db,'0011_flight_changes.sql');
    expect(await db.prepare('SELECT count(*) n FROM users').first('n')).toBe(1);
    expect(await db.prepare('SELECT count(*) n FROM flights').first('n')).toBe(1);
    expect(await db.prepare('SELECT count(*) n FROM fuel_requests').first('n')).toBe(1);
    expect(await db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'brakkevakt_%'").first<number>('n')).toBeGreaterThan(0);
    expect(await db.prepare("SELECT id FROM brakkevakt_periods WHERE id='existing-week'").first('id')).toBe('existing-week');
    for(const table of ['flight_change_events','flight_change_items','user_inbox_items'])
      expect(await db.prepare('SELECT count(*) n FROM sqlite_master WHERE type=\'table\' AND name=?').bind(table).first('n')).toBe(1);
    expect(await getEffectivePermissions(db,user)).toEqual(permissions);
  }finally{await fixture.dispose();}
},20000);
