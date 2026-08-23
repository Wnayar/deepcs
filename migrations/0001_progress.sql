-- One reader's marks: ~30 rows per user, ever.
CREATE TABLE progress (
  uid        TEXT NOT NULL,             -- Firebase sub claim, never client-supplied
  step_id    TEXT NOT NULL,             -- must exist in content/roadmap.json
  done       INTEGER NOT NULL DEFAULT 0,
  starred    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (uid, step_id)
);
