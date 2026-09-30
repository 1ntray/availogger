export type ContactNoticeType = 'NEW_FEEDBACK' | 'STUDENT_REPLY' | 'WEBMASTER_REPLY' | 'RESOLVED' | 'REOPENED';

// Recipient selection is entirely server-side. An unread notice stays one
// thread-level Inbox item; a reply after it is read starts a new notice.
export function contactNoticeStatements(db: D1Database, threadId: string, actorId: string,
  type: ContactNoticeType, messageId: string | null, stamp: string): D1PreparedStatement[] {
  const webmaster = type === 'NEW_FEEDBACK' || type === 'STUDENT_REPLY';
  const recipients = webmaster
    ? `SELECT DISTINCT p.user_id FROM contact_threads t JOIN contact_channels c ON c.id=t.channel_id
       JOIN effective_user_permissions p ON p.permission_key=c.recipient_permission_key
       WHERE t.id=? AND p.user_id<>?`
    : `SELECT t.created_by_user_id user_id FROM contact_threads t
       WHERE t.id=? AND t.created_by_user_id<>?`;
  const bind = [threadId,actorId];
  return [
    db.prepare(`INSERT INTO contact_notification_groups
      (id,user_id,thread_id,type,item_count,latest_message_id,open,created_at,updated_at)
      SELECT lower(hex(randomblob(16))),r.user_id,?,?,1,?,1,?,? FROM (${recipients}) r
      WHERE true
      ON CONFLICT(user_id,thread_id,type) WHERE open=1 DO UPDATE SET
        item_count=item_count+1,latest_message_id=excluded.latest_message_id,updated_at=excluded.updated_at`)
      .bind(threadId,type,messageId,stamp,stamp,...bind),
    db.prepare(`INSERT OR IGNORE INTO user_inbox_items(id,user_id,kind,source_type,source_id,created_at,read_at)
      SELECT lower(hex(randomblob(16))),g.user_id,'CONTACT_NOTICE','CONTACT_NOTIFICATION',g.id,?,NULL
      FROM contact_notification_groups g JOIN (${recipients}) r ON r.user_id=g.user_id
      WHERE g.thread_id=? AND g.type=? AND g.open=1`)
      .bind(stamp,...bind,threadId,type),
    db.prepare(`UPDATE user_inbox_items SET created_at=? WHERE source_type='CONTACT_NOTIFICATION'
      AND read_at IS NULL AND source_id IN
      (SELECT g.id FROM contact_notification_groups g JOIN (${recipients}) r ON r.user_id=g.user_id
       WHERE g.thread_id=? AND g.type=? AND g.open=1)`)
      .bind(stamp,...bind,threadId,type),
  ];
}
