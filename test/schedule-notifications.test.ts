import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, seedCredential, testEncryptionKey } from './d1-fixture';
import { parseDutyMeeting } from '../backend/flightlogger/duty-ops';
import { parseFlyvaskMeeting } from '../backend/flightlogger/flyvask';
import { dutyWindow } from '../backend/duty-ops/window';
import { flyvaskWindow } from '../backend/flyvask/window';
import { saveAssignments as saveDuty, saveDiscovery as discoverDuty } from '../backend/duty-ops/service';
import { saveAssignments as saveFlyvask, saveDiscovery as discoverFlyvask } from '../backend/flyvask/service';
import { listInbox, markInboxReadEndpoint } from '../backend/inbox';
import type { ApplicationUser } from '../backend/users';
import { claimGiveAway, createIntent } from '../backend/exchange-v2/service';

const date = (minute: number) => new Date(Date.parse('2026-09-27T12:00:00.000Z')+minute*60000).toISOString();
const profile = {id:'fl-student',firstName:'Student',lastName:'One'};
const dutyWindowValue = dutyWindow(new URL('https://portal.test/api/duty-ops'),new Date(date(0)));
const flyWindowValue = flyvaskWindow(new URL('https://portal.test/api/flyvask'),new Date(date(0)));
const raw = (id:string,domain:'DUTY_OPS'|'FLYVASK',start='2026-09-28T05:00:00Z',count=1) => ({
  __typename:'MeetingBooking',id,startsAt:start,endsAt:new Date(Date.parse(start)+7*3600000).toISOString(),
  status:'OPEN',externalReference:null,comment:domain==='FLYVASK'?'FLYVASK':null,
  classroom:domain==='DUTY_OPS'?{id:'852',name:'DUTY OPS'}:{id:'602',name:'Hangar UTSA'},
  participants:Array(count).fill(null),
});

describe('raw FlightLogger schedule notifications',()=>{
  let fixture:Awaited<ReturnType<typeof createTestDatabase>>,db:D1Database,user:ApplicationUser;
  beforeEach(async()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(date(0)));
    fixture=await createTestDatabase();db=fixture.db;user=await seedCredential(db);});
  afterEach(async()=>{await fixture.dispose();vi.useRealTimers();});
  const inbox=(db:D1Database,user:ApplicationUser)=>listInbox(db,user.id,new URL('https://portal.test/api/inbox'));
  async function observe(domain:'DUTY_OPS'|'FLYVASK',user:ApplicationUser,db:D1Database,records:ReturnType<typeof raw>[],minute:number,hash='key'){
    if(domain==='DUTY_OPS'){
      const meetings=records.map(record=>parseDutyMeeting(record)!);
      await discoverDuty(db,meetings,dutyWindowValue,date(minute));
      await saveDuty(db,user,profile,meetings,dutyWindowValue,date(minute+1),hash);
    }else{
      const meetings=records.map(record=>parseFlyvaskMeeting(record)!);
      await discoverFlyvask(db,meetings,flyWindowValue,date(minute));
      await saveFlyvask(db,user,profile,meetings,flyWindowValue,date(minute+1),hash);
    }
  }
  async function read(itemId:string){
    const response=await markInboxReadEndpoint({request:new Request(`https://portal.test/api/inbox/${itemId}/read`,{method:'POST',headers:{Origin:'https://portal.test'}}),
      env:{DB:db,FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY:testEncryptionKey},
      data:{accessIdentity:{subject:user.access_subject,email:user.email}},params:{itemId}} as never);
    if(response.status!==200)throw new Error(`Inbox read ${response.status}: ${await response.text()}`);
  }
  it.each(['DUTY_OPS','FLYVASK'] as const)('%s baselines, groups additions, then records changes once',async domain=>{
    const first=raw('one',domain),second=raw('two',domain,'2026-09-29T05:00:00Z');
    await observe(domain,user,db,[first],0);
    expect(await db.prepare('SELECT count(*) n FROM schedule_change_events').first('n')).toBe(0);
    expect((await inbox(db,user)).unreadCount).toBe(0);
    await observe(domain,user,db,[first,second],2);
    await observe(domain,user,db,[first,second,raw('three',domain,'2026-09-30T05:00:00Z')],4);
    let data=await inbox(db,user);
    expect(data.unreadCount).toBe(1);
    expect(data.items[0]).toMatchObject({sourceType:'SCHEDULE_NOTIFICATION_GROUP',title:`2 new ${domain==='DUTY_OPS'?'Duty Ops':'Flyvask'} assignments`});
    await observe(domain,user,db,[first,second,raw('three',domain,'2026-09-30T05:00:00Z')],6);
    expect(await db.prepare("SELECT count(*) n FROM schedule_change_events WHERE type='ASSIGNED'").first('n')).toBe(2);
    await read(data.items[0].id);
    await observe(domain,user,db,[first,second,raw('three',domain,'2026-09-30T05:00:00Z'),raw('four',domain,'2026-10-01T05:00:00Z')],8);
    data=await inbox(db,user);expect(data.unreadCount).toBe(1);
    expect(data.items[0].title).toContain('New ');
    const changed={...first,startsAt:'2026-09-28T06:00:00Z',endsAt:'2026-09-28T13:00:00Z'};
    await observe(domain,user,db,[changed,second],10);
    await observe(domain,user,db,[changed,second],12);
    expect((await db.prepare('SELECT type FROM schedule_change_events').all<{type:string}>()).results.map(row=>row.type).sort())
      .toEqual(['ASSIGNED','ASSIGNED','ASSIGNED','REMOVED','REMOVED','TIME_CHANGED']);
    expect((await inbox(db,user)).items.some(item=>item.title.includes('time changed'))).toBe(true);
  },30000);
  it.each(['DUTY_OPS','FLYVASK'] as const)('%s ignores participant changes and resets baseline on credential replacement',async domain=>{
    const one=raw('one',domain);
    await observe(domain,user,db,[one],0);
    await observe(domain,user,db,[{...one,participants:[null,null,null]}],2);
    expect(await db.prepare('SELECT count(*) n FROM schedule_change_events').first('n')).toBe(0);
    await db.prepare('UPDATE flightlogger_credentials SET token_ciphertext=token_ciphertext WHERE user_id=?').bind(user.id).run();
    await observe(domain,user,db,[one,raw('new',domain,'2026-09-29T05:00:00Z')],4);
    expect(await db.prepare('SELECT count(*) n FROM schedule_change_events').first('n')).toBe(0);
    expect((await inbox(db,user)).unreadCount).toBe(0);
  },30000);
  it('does not duplicate an assignment event during concurrent refreshes',async()=>{
    const one=raw('one','DUTY_OPS'),two=raw('two','DUTY_OPS','2026-09-29T05:00:00Z');
    await observe('DUTY_OPS',user,db,[one],0);
    const meetings=[one,two].map(record=>parseDutyMeeting(record)!);
    await discoverDuty(db,meetings,dutyWindowValue,date(2));
    const outcomes=await Promise.allSettled([
      saveDuty(db,user,profile,meetings,dutyWindowValue,date(3),'key'),
      saveDuty(db,user,profile,meetings,dutyWindowValue,date(3),'key'),
    ]);
    expect(outcomes.some(outcome=>outcome.status==='fulfilled')).toBe(true);
    expect(await db.prepare("SELECT count(*) n FROM schedule_change_events WHERE type='ASSIGNED'").first('n')).toBe(1);
    expect((await inbox(db,user)).unreadCount).toBe(1);
    expect((await inbox(db,user)).items[0].title).toBe('New Duty Ops assignment');
  },30000);
  it('does not mistake a portal Exchange give-away for a raw Duty Ops change',async()=>{
    const original=raw('raw-shift','DUTY_OPS');
    await observe('DUTY_OPS',user,db,[original],0);
    const shiftId=await db.prepare("SELECT id FROM duty_ops_shifts WHERE flightlogger_booking_id='raw-shift'").first<string>('id');
    const recipient=await seedCredential(db,'recipient','recipient-token','recipient@test','fl-recipient');
    for(const actor of [user,recipient])await db.prepare(`INSERT INTO user_permission_overrides
      (user_id,permission_key,effect,created_at,updated_at) VALUES (?,'duty_ops.swap','ALLOW',?,?)`)
      .bind(actor.id,date(0),date(0)).run();
    const intent=await createIntent(db,user,'DUTY_OPS',shiftId!,[],true);
    await claimGiveAway(db,recipient,intent.id);
    await observe('DUTY_OPS',user,db,[original],2);
    expect(await db.prepare('SELECT count(*) n FROM schedule_change_events').first('n')).toBe(0);
    expect((await inbox(db,user)).items.some(item=>item.sourceType==='EXCHANGE')).toBe(true);
  },30000);
});
