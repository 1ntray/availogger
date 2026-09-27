import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createTestDatabase,seedCredential,testEncryptionKey } from './d1-fixture';
import { parseStudentFlight,type StudentFlight } from '../backend/flightlogger/flights';
import { createFuel,updateFuel,cancelFuel,shiftTasks,completeFuel } from '../backend/flights/fuel';
import { saveOwnFlights,fuelProfile } from '../backend/flights/service';
import { flightWindow } from '../backend/flights/window';
import { fuelEndpoint,completeFuelEndpoint,shiftTasksEndpoint } from '../backend/flights/api';
import type { ApplicationUser } from '../backend/users';
import { FlightLoggerClient } from '../backend/flightlogger/client';

describe('personal flights and fuel operations',()=>{
  let db:D1Database,dispose:()=>Promise<void>|void,user:ApplicationUser,other:ApplicationUser,flight:StudentFlight,flightId:string,shiftId:string;
  const stamp=(offset=0)=>new Date(Date.now()+offset).toISOString();
  beforeEach(async()=>{
    ({db,dispose}=await createTestDatabase());
    user=await seedCredential(db,'pilot','token-pilot','pilot@example.test','fl-pilot');
    other=await seedCredential(db,'duty','token-duty','duty@example.test','fl-duty');
    const starts=new Date(Date.now()+2*3600_000).toISOString(),ends=new Date(Date.now()+3*3600_000).toISOString();
    flight={id:'booking-1',bookingType:'SingleStudentBooking',startsAt:starts,endsAt:ends,flightStartsAt:starts,flightEndsAt:ends,
      status:'OPEN',aircraft:{id:'aircraft-1',callSign:'LN-UPT',model:'Z242L',aircraftClass:'AIRPLANE',aircraftType:null,fuelCoefficientMeasurement:null},
      departureAirport:{id:'2953',name:'Bardufoss'},arrivalAirport:{id:'arrival',name:'Tromsø'},instructor:null,studentIds:['fl-pilot']};
    const window=flightWindow(new URL('https://example.test/api/flights'));
    await saveOwnFlights(db,user,[flight],window,stamp(1000),'hash');
    flightId=(await db.prepare("SELECT id FROM flights WHERE flightlogger_booking_id='booking-1'").first<{id:string}>())!.id;
    shiftId=crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT INTO duty_ops_shifts VALUES(?,?,?,?,?,?,?,?)').bind(shiftId,'duty-booking',stamp(-3600_000),stamp(8*3600_000),'OPEN',1,null,stamp()),
      db.prepare('INSERT INTO duty_ops_assignments VALUES(?,?,?)').bind(shiftId,other.id,stamp()),
    ]);
  });
  afterEach(async()=>{await dispose();});

  it('parses both booking types and rejects malformed records',()=>{
    const single={__typename:'SingleStudentBooking',id:'one',startsAt:flight.startsAt,endsAt:flight.endsAt,flightStartsAt:flight.flightStartsAt,
      flightEndsAt:flight.flightEndsAt,status:'OPEN',aircraft:{...flight.aircraft,homeAirport:null},departureAirport:flight.departureAirport,
      arrivalAirport:flight.arrivalAirport,student:{id:'fl-pilot',firstName:'Pilot',lastName:'Test'},instructor:null};
    expect(parseStudentFlight(single)?.studentIds).toEqual(['fl-pilot']);
    expect(parseStudentFlight({...single,__typename:'MultiStudentBooking',student:undefined,students:[single.student,{id:'fl-duty',firstName:null,lastName:null}]})?.studentIds).toEqual(['fl-pilot','fl-duty']);
    expect(()=>parseStudentFlight({...single,startsAt:'yesterday'})).toThrow();
  });
  it('matches only seeded aircraft profiles and has no invented DA42 presets',async()=>{
    const row=await db.prepare('SELECT * FROM flights WHERE id=?').bind(flightId).first<any>();
    expect((await fuelProfile(db,row))?.presets.map(p=>p.key)).toEqual(['FULL_MAINS','FULL_MAINS_AUX']);
    await db.prepare("UPDATE flights SET aircraft_callsign='LN-PFL' WHERE id=?").bind(flightId).run();
    const diamond=await db.prepare('SELECT * FROM flights WHERE id=?').bind(flightId).first<any>();
    expect((await fuelProfile(db,diamond))?.presets).toEqual([]);
  });
  it('creates exactly one request, limits edits to linked students, and writes audit events',async()=>{
    const choice={kind:'PRESET' as const,presetKey:'FULL_MAINS'};
    const created=await createFuel(db,user,flightId,choice);
    expect(created.status).toBe('PENDING');
    await expect(createFuel(db,user,flightId,choice)).rejects.toMatchObject({status:409});
    await expect(createFuel(db,other,flightId,choice)).rejects.toMatchObject({status:404});
    await updateFuel(db,user,flightId,{kind:'QUANTITY',quantityValue:40,quantityUnit:'L'});
    expect(await db.prepare('SELECT request_kind FROM fuel_requests WHERE id=?').bind(created.id).first('request_kind')).toBe('QUANTITY');
    expect((await db.prepare('SELECT type FROM fuel_request_events WHERE fuel_request_id=? ORDER BY created_at,id').bind(created.id).all<{type:string}>()).results.map(e=>e.type).sort())
      .toEqual(['REQUEST_CREATED','REQUEST_UPDATED']);
  });
  it('allows one winner when two linked students request fuel concurrently',async()=>{
    const shared={...flight,bookingType:'MultiStudentBooking' as const,studentIds:['fl-pilot','fl-duty']};
    await saveOwnFlights(db,user,[shared],flightWindow(new URL('https://example.test/api/flights')),stamp(2000),'hash');
    await saveOwnFlights(db,other,[shared],flightWindow(new URL('https://example.test/api/flights')),stamp(3000),'other-hash');
    const choice={kind:'QUANTITY' as const,quantityValue:30,quantityUnit:'L' as const};
    const results=await Promise.allSettled([createFuel(db,user,flightId,choice),createFuel(db,other,flightId,choice)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    expect(await db.prepare("SELECT COUNT(*) n FROM fuel_requests WHERE flight_id=? AND status='PENDING'").bind(flightId).first('n')).toBe(1);
  });
  it('routes to effective Duty Ops, completes once, and leaves assignments intact',async()=>{
    const created=await createFuel(db,user,flightId,{kind:'PRESET',presetKey:'FULL_MAINS'});
    expect((await shiftTasks(db,other,shiftId)).tasks.map(t=>t.id)).toContain(created.id);
    await expect(shiftTasks(db,user,shiftId)).rejects.toMatchObject({status:404});
    await completeFuel(db,other,shiftId,created.id);
    await expect(completeFuel(db,other,shiftId,created.id)).rejects.toMatchObject({status:409});
    expect(await db.prepare('SELECT COUNT(*) n FROM fuel_request_events WHERE type=?').bind('REQUEST_COMPLETED').first('n')).toBe(1);
    expect(await db.prepare('SELECT COUNT(*) n FROM duty_ops_assignments WHERE shift_id=?').bind(shiftId).first('n')).toBe(1);
  });
  it('moves an aircraft change to review while retaining completion history',async()=>{
    const created=await createFuel(db,user,flightId,{kind:'PRESET',presetKey:'FULL_MAINS'});
    await completeFuel(db,other,shiftId,created.id);
    const changed={...flight,aircraft:{...flight.aircraft!,id:'aircraft-2',callSign:'LN-TRB',model:'C182T'}};
    await saveOwnFlights(db,user,[changed],flightWindow(new URL('https://example.test/api/flights')),stamp(2000),'hash');
    const request=await db.prepare('SELECT status,review_reason,completed_at FROM fuel_requests WHERE id=?').bind(created.id).first<any>();
    expect(request).toMatchObject({status:'NEEDS_REVIEW',review_reason:'AIRCRAFT_CHANGED'});
    expect(request.completed_at).toBeTruthy();
    await updateFuel(db,user,flightId,{kind:'PRESET',presetKey:'TABS'});
    expect(await db.prepare('SELECT status FROM fuel_requests WHERE id=?').bind(created.id).first('status')).toBe('PENDING');
    expect(await db.prepare("SELECT COUNT(*) n FROM fuel_request_events WHERE type='REVIEW_RESOLVED'").first('n')).toBe(1);
  });
  it('cancels pending requests without removing audit history',async()=>{
    const created=await createFuel(db,user,flightId,{kind:'QUANTITY',quantityValue:20,quantityUnit:'US_GAL'});
    await cancelFuel(db,user,flightId);
    expect(await db.prepare('SELECT status FROM fuel_requests WHERE id=?').bind(created.id).first('status')).toBe('CANCELLED');
    expect(await db.prepare('SELECT COUNT(*) n FROM fuel_request_events WHERE fuel_request_id=?').bind(created.id).first('n')).toBe(2);
  });
  it('follows accepted Duty Ops transfers instead of raw assignments',async()=>{
    const created=await createFuel(db,user,flightId,{kind:'PRESET',presetKey:'FULL_MAINS'});
    const now=stamp(),requestId=crypto.randomUUID();
    await db.prepare(`INSERT INTO duty_ops_swap_requests(id,requester_user_id,requested_shift_id,requested_starts_at,requested_ends_at,
      type,status,accepted_by_user_id,accepted_proposal_id,created_at,updated_at,accepted_at,cancelled_at)
      SELECT ?,?,id,starts_at,ends_at,'GIVE_AWAY','ACCEPTED',?,NULL,?,?,?,NULL FROM duty_ops_shifts WHERE id=?`)
      .bind(requestId,other.id,user.id,now,now,now,shiftId).run();
    await expect(shiftTasks(db,other,shiftId)).rejects.toMatchObject({status:404});
    expect((await shiftTasks(db,user,shiftId)).tasks.map(t=>t.id)).toContain(created.id);
    await expect(completeFuel(db,other,shiftId,created.id)).rejects.toMatchObject({status:409});
    await completeFuel(db,user,shiftId,created.id);
  });
  it('shows a known earlier flight as advisory with the booking-end fallback',async()=>{
    const prior={...flight,id:'prior-booking',startsAt:stamp(20*60_000),endsAt:stamp(90*60_000),
      flightStartsAt:stamp(20*60_000),flightEndsAt:null};
    await saveOwnFlights(db,user,[prior,flight],flightWindow(new URL('https://example.test/api/flights')),stamp(2000),'hash');
    await createFuel(db,user,flightId,{kind:'QUANTITY',quantityValue:40,quantityUnit:'L'});
    const task=(await shiftTasks(db,other,shiftId)).tasks[0];
    expect(task.earlierFlight?.timeSource).toBe('booking');
    expect(task.earlierFlight?.endsAt).toBe(prior.endsAt);
  });
  it('shows planned work before T-60 and carries pending work to a started later shift',async()=>{
    const created=await createFuel(db,user,flightId,{kind:'PRESET',presetKey:'FULL_MAINS'});
    const planned=(await shiftTasks(db,other,shiftId,new Date())).tasks.find(t=>t.id===created.id);
    expect(planned).toBeTruthy();
    expect(Date.parse(planned!.attentionFrom)).toBeGreaterThan(Date.now());
    const laterShiftId=crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT INTO duty_ops_shifts VALUES(?,?,?,?,?,?,?,?)').bind(laterShiftId,'later-duty',stamp(4*3600_000),stamp(9*3600_000),'OPEN',1,null,stamp()),
      db.prepare('INSERT INTO duty_ops_assignments VALUES(?,?,?)').bind(laterShiftId,other.id,stamp()),
    ]);
    expect((await shiftTasks(db,other,laterShiftId,new Date(Date.now()+5*3600_000))).tasks.map(t=>t.id)).toContain(created.id);
  });
  it('rejects simulator, non-Bardufoss, cancelled and unsupported fuel options',async()=>{
    const preset={kind:'PRESET' as const,presetKey:'TABS'};
    await expect(createFuel(db,user,flightId,preset)).rejects.toMatchObject({status:400});
    for(const [column,value] of [['aircraft_class','SIMULATOR'],['departure_airport_id','other'],['status','CANCELLED']] as const){
      const prior=await db.prepare(`SELECT ${column} value FROM flights WHERE id=?`).bind(flightId).first<{value:string}>();
      await db.prepare(`UPDATE flights SET ${column}=? WHERE id=?`).bind(value,flightId).run();
      await expect(createFuel(db,user,flightId,{kind:'QUANTITY',quantityValue:20,quantityUnit:'L'})).rejects.toMatchObject({status:409});
      await db.prepare(`UPDATE flights SET ${column}=? WHERE id=?`).bind(prior!.value,flightId).run();
    }
    await expect(createFuel(db,user,flightId,{kind:'QUANTITY',quantityValue:0,quantityUnit:'L'})).rejects.toMatchObject({status:400});
  });
  it('enforces API permissions, effective membership and strict same-origin bodies',async()=>{
    const context=(path:string,method:string,subject='pilot',init:RequestInit={})=>({
      request:new Request(`https://student.luftfartsfag.no${path}`,{...init,method}),
      env:{DB:db,FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY:testEncryptionKey},
      data:{accessIdentity:{subject,email:`${subject}@example.test`}},params:{flightId,shiftId,requestId:crypto.randomUUID()},
    });
    const path=`/api/flights/${flightId}/fuel`;
    const malformed=await fuelEndpoint(context(path,'POST','pilot',{headers:{'Content-Type':'application/json',Origin:'https://student.luftfartsfag.no'},
      body:JSON.stringify({kind:'PRESET',presetKey:'FULL_MAINS',extra:true})}) as never);
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get('Cache-Control')).toBe('no-store');
    const crossSite=await fuelEndpoint(context(path,'DELETE','pilot',{headers:{Origin:'https://other.example'}}) as never);
    expect(crossSite.status).toBe(403);
    await db.prepare("INSERT INTO user_permission_overrides(user_id,permission_key,effect,created_at,updated_at) VALUES(?,?,'DENY',?,?)")
      .bind(user.id,'fuel.request',stamp(),stamp()).run();
    const denied=await fuelEndpoint(context(path,'POST','pilot',{headers:{'Content-Type':'application/json'},
      body:JSON.stringify({kind:'PRESET',presetKey:'FULL_MAINS'})}) as never);
    expect(denied.status).toBe(403);
    const task=await shiftTasksEndpoint(context(`/api/duty-ops/shifts/${shiftId}/tasks`,'GET') as never);
    expect(task.status).toBe(404); // The pilot is not the effective Duty Ops member.
    const completion=await completeFuelEndpoint({...context(`/api/duty-ops/shifts/${shiftId}/tasks/request/complete`,'POST'),
      params:{shiftId,requestId:'bad'}} as never);
    expect(completion.status).toBe(400); // Malformed request ID, never a task lookup.
  });
});

describe('bounded personal FlightLogger query',()=>{
  const record=(id:string)=>({__typename:'SingleStudentBooking',id,startsAt:'2026-10-01T10:00:00Z',endsAt:'2026-10-01T12:00:00Z',
    flightStartsAt:'2026-10-01T10:00:00Z',flightEndsAt:'2026-10-01T11:00:00Z',status:'OPEN',
    aircraft:{id:'a',callSign:'LN-UPT',model:'Z242L',aircraftClass:'AIRPLANE',aircraftType:null,fuelCoefficientMeasurement:null,homeAirport:null},
    departureAirport:{id:'2953',name:'Bardufoss'},arrivalAirport:null,student:{id:'me',firstName:null,lastName:null},instructor:null});
  it('uses all:false, paginates, and rejects looping cursors or over-budget pages',async()=>{
    const fetcher=vi.fn(async(_url:unknown,init:RequestInit)=>{
      const {query,variables}=JSON.parse(init.body as string);
      expect(query).toContain('all: false');expect(query).toContain('subtypes: [SINGLE_STUDENT, MULTI_STUDENT]');
      expect(query).not.toContain('comment');expect(variables.all).toBe(false);
      return Response.json({data:{bookings:{nodes:[record(variables.after?'second':'first')],
        pageInfo:{hasNextPage:!variables.after,endCursor:'cursor-1'}}}});
    });
    const client=new FlightLoggerClient('pagination-token',fetcher as typeof fetch,3);
    expect((await client.flights('2026-10-01T00:00:00Z','2026-10-02T00:00:00Z')).map(f=>f.id)).toEqual(['first','second']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const looping=vi.fn(async()=>Response.json({data:{bookings:{nodes:[record('first')],pageInfo:{hasNextPage:true,endCursor:'same'}}}}));
    await expect(new FlightLoggerClient('loop-token',looping as typeof fetch,3).flights('2026-10-01T00:00:00Z','2026-10-02T00:00:00Z')).rejects.toThrow('pagination stopped making progress');
  });
  it('keeps upstream 429 and Retry-After explicit',async()=>{
    const fetcher=vi.fn(async()=>new Response('',{status:429,headers:{'Retry-After':'80'}}));
    await expect(new FlightLoggerClient('new-429-token',fetcher as typeof fetch).flights('2026-10-01T00:00:00Z','2026-10-02T00:00:00Z'))
      .rejects.toMatchObject({status:429,retryAfterSeconds:80});
  });
  it('bounds the date window and rejects malformed calendar dates',()=>{
    expect(()=>flightWindow(new URL('https://portal.test/api/flights?from=2026-02-30&to=2026-03-02'))).toThrow();
    expect(()=>flightWindow(new URL('https://portal.test/api/flights?from=2026-01-01&to=2026-06-01'))).toThrow();
    expect(()=>flightWindow(new URL('https://portal.test/api/flights?user=someone'))).toThrow();
  });
});
