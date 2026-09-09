-- ============================================================
-- Migração 0014: login opcional por password
-- ============================================================
--
-- Por defeito, ambas ficam NULL -- a conta continua a exigir sempre
-- código de verificação por email para entrar, exatamente como hoje.
-- Só passa a aceitar password como alternativa depois de a pessoa a
-- definir explicitamente (nunca é obrigatório).
--
-- password_hash: hash PBKDF2-SHA256 (ver worker/src/password.ts),
-- nunca a password em texto simples.
-- password_salt: salt aleatório usado nesse hash, único por conta e
-- por cada vez que a password é definida/trocada.

ALTER TABLE dealers ADD COLUMN password_hash TEXT;
ALTER TABLE dealers ADD COLUMN password_salt TEXT;
