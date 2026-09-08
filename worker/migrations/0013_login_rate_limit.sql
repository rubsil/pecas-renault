-- ============================================================
-- Migração 0013: rate limiting no pedido de código de login
-- ============================================================
--
-- Evita que alguém (por engano, ao testar, ou de propósito) peça
-- código repetidamente para a mesma conta, gastando a quota diária
-- do Gmail (100 unidades por envio) sem necessidade real.
--
-- login_code_requests_count: quantos pedidos foram feitos na janela
-- atual. login_code_window_started_at: quando a janela atual começou
-- -- ao passar 1 hora desde esse momento, a contagem reinicia.

ALTER TABLE dealers ADD COLUMN login_code_requests_count INTEGER DEFAULT 0;
ALTER TABLE dealers ADD COLUMN login_code_window_started_at TEXT;
