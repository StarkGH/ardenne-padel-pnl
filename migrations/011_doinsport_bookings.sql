-- Migration 011 — Table doinsport_bookings
-- Import des réservations Doinsport depuis padel.db (SQLite padel-service)
-- Source : /home/stark2026/projects/padel-service/padel.db

CREATE TABLE IF NOT EXISTS doinsport_bookings (
  id                TEXT PRIMARY KEY,       -- UUID Doinsport
  court_key         TEXT,                   -- 'Padel 1' / 'Padel 2' / 'Padel 3' / 'Padel 4'
  playground_name   TEXT,                   -- nom brut Doinsport
  start_at          TIMESTAMPTZ,
  end_at            TIMESTAMPTZ,
  start_date        DATE,                   -- date locale Europe/Brussels (pour agrégats)
  duration_min      INTEGER,                -- durée en minutes
  price_cents       INTEGER,
  payments_cents    INTEGER,
  rest_to_pay_cents INTEGER,
  price_eur         NUMERIC(8,2),           -- price_cents / 100
  canceled          BOOLEAN DEFAULT FALSE,
  canceled_at       TIMESTAMPTZ,
  name              TEXT,                   -- nom de la réservation
  reservant         TEXT,                   -- personne qui a réservé
  participants_count INTEGER,
  activity_name     TEXT,                   -- 'Padel simple', 'Padel Classique'
  timetable_name    TEXT,                   -- '1H Padel HC', '1H30 Padel HP - 4 participants'
  origin            TEXT,                   -- 'white_label_app', 'administration', 'online'
  access_code       TEXT,
  imported_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doin_date      ON doinsport_bookings(start_date);
CREATE INDEX IF NOT EXISTS idx_doin_court     ON doinsport_bookings(court_key);
CREATE INDEX IF NOT EXISTS idx_doin_canceled  ON doinsport_bookings(canceled);
CREATE INDEX IF NOT EXISTS idx_doin_origin    ON doinsport_bookings(origin);
CREATE INDEX IF NOT EXISTS idx_doin_activity  ON doinsport_bookings(activity_name);
