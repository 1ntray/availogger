import { describe, expect, it } from 'vitest';
import { applyTestMigration, createTestDatabase, seedCredential } from './d1-fixture';

describe('0015 schedule notifications migration',()=>{
  it('upgrades populated 0014 without changing existing assignments or Inbox rows',async()=>{
    const fixture=await createTestDatabase(true,'0014_flight_schedule_details.sql');
    try{
      const {db}=fixture,user=await seedCredential(fixture.db);
      await db.prepare(`INSERT INTO duty_ops_shifts
        (id,flightlogger_booking_id,starts_at,ends_at,status,participant_count,last_synced_at)
        VALUES ('old-shift','old-booking','2026-10-01T08:00:00Z','2026-10-01T13:00:00Z','OPEN',1,'2026-09-29T00:00:00Z')`).run();
      await db.prepare('INSERT INTO duty_ops_assignments VALUES (?,?,?)').bind('old-shift',user.id,'2026-09-29T00:00:00Z').run();
      await db.prepare(`INSERT INTO user_inbox_items VALUES
        ('old-inbox',?,'INFO','UNKNOWN','old-source','2026-09-29T00:00:00Z',NULL)`).bind(user.id).run();
      await applyTestMigration(db,'0015_schedule_notifications.sql');
      expect(await db.prepare('SELECT count(*) n FROM duty_ops_assignments').first('n')).toBe(1);
      expect(await db.prepare('SELECT count(*) n FROM user_inbox_items').first('n')).toBe(1);
      expect(await db.prepare('SELECT count(*) n FROM schedule_change_events').first('n')).toBe(0);
      expect(await db.prepare('SELECT count(*) n FROM schedule_observation_state').first('n')).toBe(0);
    }finally{await fixture.dispose();}
  },20000);
});
