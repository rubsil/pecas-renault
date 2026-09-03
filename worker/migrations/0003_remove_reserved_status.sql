-- ============================================================
-- Migração 0003: remove o estado 'reserved', nunca usado
-- ============================================================
--
-- 'reserved' existia no schema desde o início mas nunca teve nenhuma
-- ação correspondente no dashboard do concessionário -- só o painel
-- de administrador o mostrava, sem ninguém alguma vez o usar. Estado
-- órfão, removido para simplificar.
--
-- Se por acaso alguma peça ficou com este estado (não deveria haver
-- nenhuma), volta a 'active' em vez de desaparecer silenciosamente --
-- mais seguro do que perder uma peça publicada por engano.

UPDATE parts_listings SET status = 'active' WHERE status = 'reserved';
