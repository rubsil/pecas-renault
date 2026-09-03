-- ============================================================
-- Migração 0004: data de verificação dos concessionários
-- ============================================================
--
-- Até agora só existia o booleano `verified`, sem registar quando é
-- que isso aconteceu. Necessário para o painel de admin mostrar
-- "verificado em X" em vez de só um sim/não.

ALTER TABLE dealers ADD COLUMN verified_at TEXT;

-- Contas já verificadas antes desta migração ficam com a data de
-- criação como aproximação -- não sabemos a data real de verificação,
-- mas é melhor que ficar vazio.
UPDATE dealers SET verified_at = created_at WHERE verified = 1 AND verified_at IS NULL;
