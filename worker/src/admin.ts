// worker/src/admin.ts
// Autenticação simples de administrador: password fixa, guardada como
// Cloudflare Secret (env.ADMIN_PASSWORD), nunca no código nem na D1.
//
// Não há sessões nem tokens — cada pedido ao painel de admin traz a
// password no header. Isto é aceitável porque:
//   - só uma pessoa (o admin) usa isto
//   - é sempre por HTTPS (Cloudflare Workers força isso)
//   - o volume de pedidos é baixíssimo (um painel de gestão manual)
// Se um dia isto precisar de ser mais robusto (vários admins, por
// exemplo), vale a pena migrar para um esquema de sessão como o dos
// concessionários — mas seria complexidade a mais para o que isto é.

export function checkAdminAuth(request: Request, env: { ADMIN_PASSWORD?: string }): boolean {
  if (!env.ADMIN_PASSWORD) return false; // sem secret definido, admin fica sempre bloqueado
  const provided = request.headers.get("x-admin-password");
  if (!provided) return false;
  // Aparar espaços/quebras de linha em ambos os lados, por segurança —
  // alguns editores de secrets no dashboard podem introduzir um "\n"
  // final sem intenção, o que faria a comparação exata falhar sempre.
  return provided.trim() === env.ADMIN_PASSWORD.trim();
}
