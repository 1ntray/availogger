import { expect,it } from 'vitest';
import { applyTestMigration,createTestDatabase,seedCredential } from './d1-fixture';
import { getEffectivePermissions } from '../backend/authorization';

it('adds flights and fuel to a populated post-0008 database without disturbing existing users',async()=>{
  const fixture=await createTestDatabase(true,'0008_duty_ops_credits.sql');
  try{
    const user=await seedCredential(fixture.db,'existing-student','existing-token');
    const before=await fixture.db.prepare('SELECT flightlogger_user_id FROM users WHERE id=?').bind(user.id).first('flightlogger_user_id');
    await applyTestMigration(fixture.db,'0009_flights_fuel.sql');
    expect(await fixture.db.prepare('SELECT flightlogger_user_id FROM users WHERE id=?').bind(user.id).first('flightlogger_user_id')).toBe(before);
    expect(await getEffectivePermissions(fixture.db,user)).toContain('flights.view');
    expect(await getEffectivePermissions(fixture.db,user)).toContain('fuel.request');
    expect(await fixture.db.prepare('SELECT COUNT(*) n FROM fuel_profiles').first('n')).toBe(3);
    expect(await fixture.db.prepare('SELECT COUNT(*) n FROM fuel_presets').first('n')).toBe(5);
  }finally{await fixture.dispose();}
},10000);
