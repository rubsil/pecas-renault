-- ============================================================
-- Migração 0001: email obrigatório + confirmação de email
-- ============================================================
--
-- Contexto: o email passa a ser obrigatório no registo (contacto por
-- escrito, além do telefone) e a chave para o login. Para evitar que
-- um erro de digitação no email bloqueie o acesso, o email só se torna
-- ativo para login depois de confirmado uma vez no momento do registo
-- (código de confirmação enviado logo a seguir a criar a conta).
--
-- Correções de contas com email errado ficam para alteração manual
-- direta na base de dados (ver README), dado o volume pequeno de
-- concessionários.

ALTER TABLE dealers ADD COLUMN email_confirmed INTEGER DEFAULT 0;

-- Contas já existentes antes desta migração (ex: a conta de teste do
-- Faial) ficam automaticamente confirmadas, para não perderem acesso.
UPDATE dealers SET email_confirmed = 1 WHERE email IS NOT NULL AND email != '';
