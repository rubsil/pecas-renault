-- ============================================================
-- Schema: Rede de Peças Paradas — registo interno de stock parado
-- entre concessionários/agentes Renault e Dacia
-- ============================================================

-- Lista oficial de concessionários, importada da página pública
-- da Renault. Usada como fonte de verdade para validar registos.
CREATE TABLE IF NOT EXISTS official_dealers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  company_name_normalized TEXT NOT NULL,   -- lowercase, sem acentos, para matching
  address TEXT,
  postal_code TEXT,
  city TEXT,
  phone TEXT,
  phone_normalized TEXT,                    -- só dígitos, para matching
  source_url TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_official_phone ON official_dealers(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_official_name ON official_dealers(company_name_normalized);

-- Contas de concessionários registados na plataforma.
-- Cada conta é cruzada contra official_dealers no momento do registo.
CREATE TABLE IF NOT EXISTS dealers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  contact_name TEXT,                        -- pessoa responsável (ex: chefe de peças)
  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  email TEXT NOT NULL,                      -- obrigatório: contacto por escrito + login
  email_confirmed INTEGER DEFAULT 0,        -- 0 = à espera de confirmação no registo, 1 = confirmado
  address TEXT,
  postal_code TEXT,
  city TEXT,
  lat REAL,
  lon REAL,
  official_dealer_id INTEGER REFERENCES official_dealers(id),  -- NULL se não cruzou automaticamente
  verified INTEGER DEFAULT 0,               -- 0 = pendente, 1 = verificado
  verification_method TEXT,                 -- 'auto_match' | 'manual'
  login_token TEXT,                         -- token atual para magic link (rotativo)
  login_token_expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dealers_phone ON dealers(phone_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dealers_email ON dealers(email) WHERE email IS NOT NULL;

-- Peças anunciadas por cada concessionário.
CREATE TABLE IF NOT EXISTS parts_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id),
  reference TEXT NOT NULL,                  -- ex: 8200-123456
  reference_normalized TEXT NOT NULL,       -- sem espaços/hífens, uppercase, para pesquisa
  description TEXT,                         -- nome da peça, pode ficar vazio inicialmente
  quantity INTEGER NOT NULL DEFAULT 1,
  brand TEXT NOT NULL DEFAULT 'renault',    -- 'renault' | 'dacia'
  notes TEXT,                               -- "novo/selado", "embalagem aberta", etc
  status TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'sold' | 'removed'
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listings_reference ON parts_listings(reference_normalized);
CREATE INDEX IF NOT EXISTS idx_listings_dealer ON parts_listings(dealer_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON parts_listings(status);

-- Alertas: um concessionário pode pedir para ser avisado
-- quando uma referência específica for publicada.
CREATE TABLE IF NOT EXISTS reference_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id),
  reference_normalized TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  notified_at TEXT                          -- NULL até ser notificado
);

CREATE INDEX IF NOT EXISTS idx_alerts_reference ON reference_alerts(reference_normalized);
CREATE INDEX IF NOT EXISTS idx_alerts_dealer ON reference_alerts(dealer_id);

-- Configurações editáveis pelo admin (ex: password de registo).
-- Ver worker/migrations/0002_settings_table.sql para o contexto.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_password', '');
