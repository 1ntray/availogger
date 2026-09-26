-- Access subject is the identity key. Emails are metadata, not unique identities.
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  access_subject TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  flightlogger_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE flightlogger_credentials (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  encryption_version INTEGER NOT NULL CHECK (encryption_version = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
