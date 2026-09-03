-- ============================================================
-- Migração 0006: referências de substituição
-- ============================================================
--
-- Uma peça pode ter várias referências ao longo do tempo (código
-- antigo, código novo, código de fornecedor diferente). Sem isto,
-- quem pesquisa pela referência "errada" não encontra a peça, mesmo
-- que esteja publicada. Cada linha é uma referência alternativa
-- ligada a uma peça -- não há limite ao número de alternativas.

CREATE TABLE IF NOT EXISTS listing_alt_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES parts_listings(id),
  reference TEXT NOT NULL,              -- tal como o utilizador escreveu
  reference_normalized TEXT NOT NULL,   -- para pesquisa, mesmo padrão da referência principal
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alt_ref_normalized ON listing_alt_references(reference_normalized);
CREATE INDEX IF NOT EXISTS idx_alt_ref_listing ON listing_alt_references(listing_id);
