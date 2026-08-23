-- Who paid. D1 is a cache of Stripe's ledger, rebuildable from it
-- (DESIGN.md §9): losing this table is an inconvenience, not a broken
-- promise.
CREATE TABLE entitlements (
  uid               TEXT NOT NULL,        -- Firebase sub, from client_reference_id
  product           TEXT NOT NULL DEFAULT 'lifetime',
  provider_order_id TEXT NOT NULL,        -- Stripe payment intent: what a refund names
  provider_event_id TEXT NOT NULL UNIQUE, -- Stripe event id: webhook idempotency
  purchased_at      TEXT NOT NULL,
  revoked_at        TEXT,                 -- set by the refund webhook
  PRIMARY KEY (uid, product)
);
