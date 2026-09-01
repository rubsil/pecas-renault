// worker/src/auth.ts
// Autenticação simples por "magic link" — sem passwords a gerir.
// O concessionário pede um código, recebe por email, usa-o para entrar.
// O token de sessão resultante é um UUID guardado em dealers.login_token.

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomCode(): string {
  // Código curto de 6 dígitos, fácil de escrever/dizer ao telefone se preciso.
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export interface PendingLogin {
  dealerId: number;
  code: string;
  expiresAt: string;
}

/** Cria um código de login válido por 15 minutos e guarda-o na BD. */
export async function createLoginCode(db: D1Database, dealerId: number): Promise<string> {
  const code = randomCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await db
    .prepare("UPDATE dealers SET login_token = ?, login_token_expires_at = ? WHERE id = ?")
    .bind(code, expiresAt, dealerId)
    .run();
  return code;
}

/** Verifica um código e, se válido, emite um token de sessão de longa duração. */
export async function redeemLoginCode(
  db: D1Database,
  dealerId: number,
  code: string
): Promise<string | null> {
  const dealer = await db
    .prepare("SELECT login_token, login_token_expires_at FROM dealers WHERE id = ?")
    .bind(dealerId)
    .first<{ login_token: string | null; login_token_expires_at: string | null }>();

  if (!dealer || dealer.login_token !== code) return null;
  if (!dealer.login_token_expires_at || new Date(dealer.login_token_expires_at) < new Date()) return null;

  const sessionToken = randomToken();
  // Reutiliza a mesma coluna para o token de sessão, agora de longa duração (30 dias).
  const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      "UPDATE dealers SET login_token = ?, login_token_expires_at = ?, last_login_at = datetime('now') WHERE id = ?"
    )
    .bind(sessionToken, sessionExpiry, dealerId)
    .run();

  return sessionToken;
}

/** Resolve um token de sessão (do header Authorization) para o dealer_id. */
export async function resolveSession(db: D1Database, token: string | null): Promise<number | null> {
  if (!token) return null;
  const dealer = await db
    .prepare("SELECT id, login_token_expires_at FROM dealers WHERE login_token = ?")
    .bind(token)
    .first<{ id: number; login_token_expires_at: string | null }>();

  if (!dealer) return null;
  if (!dealer.login_token_expires_at || new Date(dealer.login_token_expires_at) < new Date()) return null;

  return dealer.id;
}
