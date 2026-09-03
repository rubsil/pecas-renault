-- ============================================================
-- Migração 0005: log de atividade do painel de administrador
-- ============================================================
--
-- Regista ações destrutivas ou importantes feitas pelo admin
-- (eliminar, verificar, criar manualmente) para dar rasto de
-- auditoria. Não regista leituras (GET), só escritas.

CREATE TABLE IF NOT EXISTS admin_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,            -- ex: 'dealer_deleted', 'dealer_verified', 'listing_deleted'
  target_type TEXT NOT NULL,       -- 'dealer' | 'listing' | 'official_dealer' | 'setting'
  target_id TEXT,                  -- id do que foi afetado (texto para caber IDs de settings tb)
  detail TEXT,                     -- descrição livre, ex: nome da empresa eliminada
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON admin_activity_log(created_at);
