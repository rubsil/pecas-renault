-- ============================================================
-- Migração 0007: coordenadas na lista oficial de concessionários
-- ============================================================
--
-- Os edifícios não mudam de sítio -- faz mais sentido geocodificar
-- os 97 concessionários oficiais uma vez, de forma definitiva, do que
-- ficar dependente de cada conta se registar primeiro. Contas novas
-- podem herdar estas coordenadas diretamente via official_dealer_id,
-- sem precisar de geocodificar outra vez.

ALTER TABLE official_dealers ADD COLUMN lat REAL;
ALTER TABLE official_dealers ADD COLUMN lon REAL;
ALTER TABLE official_dealers ADD COLUMN geocoded_at TEXT;
