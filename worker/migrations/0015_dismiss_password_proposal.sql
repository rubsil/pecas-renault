-- ============================================================
-- Migração 0015: opção de não mostrar mais a proposta de password
-- ============================================================
--
-- Sem isto, o modal a propor definir password reaparecia em TODOS os
-- logins por código enquanto a conta não tivesse uma definida --
-- irritante para quem decide conscientemente continuar a usar código
-- por email. 0 = continua a mostrar (default), 1 = já disse "não
-- voltar a mostrar".

ALTER TABLE dealers ADD COLUMN dismissed_password_proposal INTEGER DEFAULT 0;
