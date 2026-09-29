import { expect,it } from 'vitest';
import { applyTestMigration,createTestDatabase,seedCredential } from './d1-fixture';

it('adds bounded planned lesson storage to populated 0013 without changing canonical flights or requests',async()=>{
  const fixture=await createTestDatabase(true,'0013_contact_messages.sql');
  try{
    const db=fixture.db,user=await seedCredential(db,'student','token');
    await db.prepare(`INSERT INTO flights(id,flightlogger_booking_id,booking_type,starts_at,ends_at,status,last_synced_at)
      VALUES('old-flight','old-booking','SingleStudentBooking','2026-10-01T08:00:00.000Z','2026-10-01T10:00:00.000Z','OPEN','2026-09-29T08:00:00.000Z')`).run();
    await db.prepare(`INSERT INTO fuel_requests(id,flight_id,requested_by_user_id,status,request_kind,quantity_value,quantity_unit,
      flightlogger_booking_id,flightlogger_aircraft_id_snapshot,departure_airport_id_snapshot,created_at,updated_at)
      VALUES('old-fuel','old-flight',?,'PENDING','QUANTITY',150,'L','old-booking','aircraft-1','2953','2026-09-29T08:00:00.000Z','2026-09-29T08:00:00.000Z')`)
      .bind(user.id).run();
    await applyTestMigration(db,'0014_flight_schedule_details.sql');
    expect(await db.prepare('SELECT count(*) n FROM flights').first('n')).toBe(1);
    expect(await db.prepare('SELECT count(*) n FROM fuel_requests').first('n')).toBe(1);
    expect(await db.prepare('SELECT count(*) n FROM flight_planned_lessons').first('n')).toBe(0);
    await db.prepare(`INSERT INTO flight_planned_lessons VALUES('old-flight',0,'training-1','4.2 Instrument approaches',NULL,NULL)`).run();
    expect(await db.prepare('SELECT training_name FROM flight_planned_lessons').first('training_name')).toBe('4.2 Instrument approaches');
  }finally{await fixture.dispose();}
},20000);
