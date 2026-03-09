-- 007_nowjobs.sql
-- Prestations NOWJOBS (intérimaires bar) — planning Vert/Accepté

CREATE TABLE IF NOT EXISTS nowjobs_prestations (
    id              SERIAL PRIMARY KEY,
    shift_date      DATE NOT NULL,
    iso_week        VARCHAR(20),           -- Semaine ISO (ex: S43)
    day_name        VARCHAR(20),           -- Lundi, Mardi, etc.
    employee_name   VARCHAR(100),          -- Nom + Prénom
    start_time      VARCHAR(20),           -- HH:MM
    end_time        VARCHAR(20),           -- HH:MM
    break_minutes   NUMERIC(5,1),          -- Break en minutes (converti depuis HH:MM)
    prestation_num  INTEGER,               -- N° Prestation du jour
    duration_h      NUMERIC(8,4),          -- Durée Prestation (h décimal)
    daily_hours     NUMERIC(8,4),          -- Total Heures Journée (h décimal)
    total_employees INTEGER,               -- Total Employés ce jour
    daily_cost      NUMERIC(10,2),         -- Total Coûts Salariaux (€) — coût total de la journée
    cost_prorata    NUMERIC(10,2),         -- Coût Prestation au prorata (€) — part de cet employé
    hourly_rate     NUMERIC(8,4),          -- Coût à l'heure (€/h)
    statut          VARCHAR(100),           -- Statut (Vert, Accepté, etc.)
    imported_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nowjobs_date ON nowjobs_prestations(shift_date);
CREATE INDEX IF NOT EXISTS idx_nowjobs_week ON nowjobs_prestations(iso_week);
