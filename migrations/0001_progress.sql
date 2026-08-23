-- One reader's marks. ~30 rows per user, forever: a step is either ticked
-- or it is not (DESIGN.md §10).
CREATE TABLE progress (
  uid        TEXT NOT NULL,             -- Firebase sub claim, never client-supplied
  step_id    TEXT NOT NULL,             -- must exist in content/roadmap.json
  done       INTEGER NOT NULL DEFAULT 0,
  starred    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (uid, step_id)
);
