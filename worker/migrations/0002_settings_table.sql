-- ============================================================
-- Migração 0002: tabela de configurações editáveis pelo admin
-- ============================================================
--
-- Guarda valores que o admin pode mudar através do painel, sem
-- precisar de mexer em código nem em secrets da Cloudflare. Por agora
-- só tem a password de registo, mas fica preparada para outros valores
-- futuros (chave-valor genérica).

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Valor inicial: sem password de registo definida (registo aberto,
-- tal como está hoje). O admin define uma no painel quando quiser
-- fechar o registo a quem não tiver o código.
INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_password', '');
