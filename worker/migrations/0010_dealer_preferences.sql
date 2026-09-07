-- ============================================================
-- Migração 0010: preferências de visualização por concessionário
-- ============================================================
--
-- Guardadas no backend, ligadas à conta -- em vez de só no
-- localStorage do browser, sobrevivem a trocar de dispositivo ou
-- limpar dados do browser. O localStorage continua a ser usado para
-- quem está a pesquisar sem sessão (não há conta para gravar).
--
-- 1 = mostrar/ativo, 0 = esconder/inativo. Default 1 para thumbnails
-- (mesmo comportamento que já existia antes desta funcionalidade),
-- default 0 para lista compacta (idem).

ALTER TABLE dealers ADD COLUMN pref_photo_thumbnails INTEGER DEFAULT 1;
ALTER TABLE dealers ADD COLUMN pref_compact_list INTEGER DEFAULT 0;
