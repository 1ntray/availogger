-- 0002 is reserved for the parallel Duty Ops branch. Never renumber 0001.
CREATE TABLE roles (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE TABLE permissions (key TEXT PRIMARY KEY NOT NULL, description TEXT NOT NULL);
-- statement-breakpoint
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);
-- statement-breakpoint
CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id)
);
-- statement-breakpoint
CREATE INDEX user_roles_by_role ON user_roles(role_id, user_id);
-- statement-breakpoint
CREATE TABLE user_permission_overrides (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  effect TEXT NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  changed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, permission_key)
);
-- statement-breakpoint
CREATE TABLE authorization_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('ROLE_ADDED', 'ROLE_REMOVED', 'OVERRIDE_SET', 'OVERRIDE_REMOVED')),
  permission_key TEXT REFERENCES permissions(key) ON DELETE SET NULL,
  role_key TEXT,
  previous_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX authorization_audit_by_target ON authorization_audit_log(target_user_id, created_at);
-- statement-breakpoint
-- A global revision serializes access editors and bootstrap. A negative revision
-- aborts the entire D1 batch, including access changes and their audit records.
CREATE TABLE authorization_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CONSTRAINT authorization_guard CHECK (revision >= 0)
);
-- statement-breakpoint
INSERT INTO authorization_state VALUES (1, 0);
-- statement-breakpoint
INSERT INTO roles VALUES
  ('system-admin', 'ADMIN', 'Administrator', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('system-student', 'STUDENT', 'Student', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
-- statement-breakpoint
INSERT INTO permissions VALUES
  ('availability.view', 'Instructor availability'),
  ('duty_ops.view', 'View Duty Ops'),
  ('duty_ops.swap', 'Swap Duty Ops assignments'),
  ('duty_ops.manage_schedule', 'Manage Duty Ops schedule'),
  ('transport.view', 'View Transport'),
  ('transport.offer_private_ride', 'Offer private rides'),
  ('transport.manage_university_cars', 'Manage university cars'),
  ('admin.manage_users', 'Manage users'),
  ('admin.manage_permissions', 'Manage permissions');
-- statement-breakpoint
INSERT INTO role_permissions SELECT 'system-admin', key FROM permissions;
-- statement-breakpoint
INSERT INTO role_permissions VALUES ('system-student', 'duty_ops.view'), ('system-student', 'transport.view');
-- statement-breakpoint
INSERT INTO user_roles (user_id, role_id, created_at)
  SELECT id, 'system-student', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM users
  WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = users.id);
-- statement-breakpoint
-- Defaults apply only on account creation, never reassigning a removed role.
CREATE TRIGGER new_user_student_role AFTER INSERT ON users
BEGIN
  INSERT INTO user_roles (user_id, role_id, created_at) VALUES (NEW.id, 'system-student', NEW.created_at);
END;
-- statement-breakpoint
-- One resolver, also used by transactional actor/final-admin checks.
CREATE VIEW effective_user_permissions AS
  SELECT u.id AS user_id, p.key AS permission_key FROM users u CROSS JOIN permissions p
  LEFT JOIN user_permission_overrides o ON o.user_id = u.id AND o.permission_key = p.key
  WHERE CASE
    WHEN o.effect = 'DENY' THEN 0
    WHEN o.effect = 'ALLOW' THEN 1
    ELSE EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = u.id AND rp.permission_key = p.key)
  END;
