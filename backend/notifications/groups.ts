type Domain = 'FLIGHTS' | 'DUTY_OPS' | 'FLYVASK';

// All statements are appended to the domain's D1 batch after its immutable
// events. The partial unique index serializes concurrent writers per user and
// domain; reading the Inbox item closes that group in the same D1 transaction.
function groupStatements(db: D1Database, userId: string, domain: Domain, stamp: string,
  events: string, eventColumn: 'flight_event_id' | 'schedule_event_id', values: unknown[]): D1PreparedStatement[] {
  const source = `SELECT id FROM ${events}`;
  return [
    db.prepare(`INSERT INTO inbox_notification_groups(id,user_id,domain,item_count,open,created_at,updated_at)
      SELECT lower(hex(randomblob(16))),?,?,count(*),1,?,? FROM (${source}) HAVING count(*)>0
      ON CONFLICT(user_id,domain) WHERE open=1 DO UPDATE SET
        item_count=item_count+excluded.item_count,updated_at=excluded.updated_at`)
      .bind(userId,domain,stamp,stamp,...values),
    db.prepare(`INSERT OR IGNORE INTO inbox_notification_group_events(group_id,${eventColumn})
      SELECT g.id,e.id FROM inbox_notification_groups g CROSS JOIN (${source}) e
      WHERE g.user_id=? AND g.domain=? AND g.open=1`).bind(...values,userId,domain),
    db.prepare(`INSERT OR IGNORE INTO user_inbox_items(id,user_id,kind,source_type,source_id,created_at,read_at)
      SELECT lower(hex(randomblob(16))),user_id,'SCHEDULE_ASSIGNMENTS','SCHEDULE_NOTIFICATION_GROUP',id,?,NULL
      FROM inbox_notification_groups WHERE user_id=? AND domain=? AND open=1`)
      .bind(stamp,userId,domain),
    db.prepare(`UPDATE user_inbox_items SET created_at=? WHERE source_type='SCHEDULE_NOTIFICATION_GROUP'
      AND source_id=(SELECT id FROM inbox_notification_groups WHERE user_id=? AND domain=? AND open=1)
      AND read_at IS NULL AND EXISTS(${source})`).bind(stamp,userId,domain,...values),
  ];
}

export function flightAdditionGroupStatements(db: D1Database, userId: string, rowsJson: string, stamp: string) {
  const events = `flight_change_events WHERE id IN
    (SELECT json_extract(value,'$.addedEventId') FROM json_each(?)) AND type='FLIGHT_ADDED' AND subject_user_id=?`;
  return groupStatements(db,userId,'FLIGHTS',stamp,events,'flight_event_id',[rowsJson,userId]);
}

export function scheduleAdditionGroupStatements(db: D1Database, userId: string,
  domain: Exclude<Domain,'FLIGHTS'>, observationId: string, stamp: string) {
  const events = "schedule_change_events WHERE observation_id=? AND user_id=? AND domain=? AND type='ASSIGNED'";
  return groupStatements(db,userId,domain,stamp,events,'schedule_event_id',[observationId,userId,domain]);
}
