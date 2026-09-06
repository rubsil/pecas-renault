-- ============================================================
-- Migração 0009: conta de demonstração
-- ============================================================
--
-- Uma única conta especial, sempre com o mesmo id fixo, usada para
-- apresentações a quem ainda não tem conta real (ex: Renault
-- Portugal). Login sem código de email -- ver worker/src/index.ts,
-- rota /api/auth/demo-login, que reconhece telefone "demo" +
-- email "modo@demo" e entra direto.
--
-- Reposta ao estado inicial ao terminar sessão (logout) e por uma
-- rede de segurança de 6 em 6 horas (Cron Trigger), para o caso de
-- ninguém fazer logout explícito -- ver função resetDemoAccount()
-- em worker/src/index.ts.
--
-- Invisível em todas as rotas públicas (pesquisa, mapa) -- qualquer
-- query que devolva concessionários ou peças ao público em geral
-- filtra explicitamente WHERE is_demo = 0 (ou equivalente via JOIN).

ALTER TABLE dealers ADD COLUMN is_demo INTEGER DEFAULT 0;

INSERT INTO dealers (
  id, company_name, phone, phone_normalized, email, email_confirmed,
  city, verified, verification_method, is_demo
) VALUES (
  999999, 'Concessionário Demo', 'demo', 'demo', 'modo@demo', 1,
  'Cidade de Demonstração', 1, 'demo', 1
);
