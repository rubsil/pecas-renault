-- ============================================================
-- Migração 0011: mais preferências de visualização
-- ============================================================
--
-- Continuação da migração 0010. Duas novas preferências:
--
-- pref_sort_order: como ordenar os resultados por defeito na
-- pesquisa pública. 'recent' (mais recentes primeiro, o
-- comportamento que já existia antes desta funcionalidade) ou
-- 'distance' (mais próximos primeiro -- só funciona de facto quando
-- há sessão e coordenadas, mas a preferência fica guardada de
-- qualquer forma).
--
-- pref_default_view: qual separador abre por defeito na pesquisa
-- pública. 'list' (o que já existia) ou 'map'.

ALTER TABLE dealers ADD COLUMN pref_sort_order TEXT DEFAULT 'recent';
ALTER TABLE dealers ADD COLUMN pref_default_view TEXT DEFAULT 'list';
