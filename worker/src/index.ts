// worker/src/index.ts
// API principal da Rede de Peças Paradas. Cloudflare Worker + D1.
//
// Rotas:
//   POST /api/dealers/register        — regista novo concessionário
//   GET  /api/dealers/suggest?q=...   — sugestões de nome (lista oficial), para autocomplete
//   POST /api/auth/request-code       — pede código de login (magic link)
//   POST /api/auth/redeem-code        — troca código por sessão
//   GET  /api/dealers/me              — dados do concessionário autenticado
//
//   POST /api/listings                — publica peça (autenticado)
//   PATCH /api/listings/:id           — atualiza estado (sold/removed) (autenticado, dono)
//   GET  /api/listings/browse         — lista todas as peças ativas (sem pesquisa)
//   GET  /api/listings/search?ref=... — pesquisa por referência
//   GET  /api/listings/mine           — listagens do próprio concessionário (autenticado)
//
//   POST /api/alerts                  — subscreve alerta de referência (autenticado)
//   GET  /api/alerts/mine             — alertas do próprio concessionário (autenticado)
//
//   Painel de administrador (protegido por header x-admin-password):
//   GET    /api/admin/stats                 — estatísticas rápidas (contas, verificados, peças)
//   GET    /api/admin/dealers               — lista todos os concessionários
//   PATCH  /api/admin/dealers/:id           — edita um concessionário (nome, telefone, email, verified)
//   DELETE /api/admin/dealers/:id           — elimina um concessionário e as suas peças
//   GET    /api/admin/listings              — lista todas as peças (qualquer estado)
//   PATCH  /api/admin/listings/:id          — edita qualquer peça
//   DELETE /api/admin/listings/:id          — elimina qualquer peça
//   GET    /api/admin/settings              — lê configurações (ex: password de registo)
//   PUT    /api/admin/settings/:key         — muda uma configuração
//
//   GET  /health                      — health check

import { normalizePhone, normalizeReference, normalizeText } from "./normalize";
import { verifyAgainstOfficialList } from "./verification";
import { createLoginCode, redeemLoginCode, resolveSession } from "./auth";
import { checkAdminAuth } from "./admin";

export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization, x-admin-password",
      "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      ...(init.headers || {}),
    },
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function requireDealer(request: Request, env: Env): Promise<number | Response> {
  const token = bearerToken(request);
  const dealerId = await resolveSession(env.DB, token);
  if (!dealerId) return json({ error: "Sessão inválida ou expirada. Faz login novamente." }, { status: 401 });
  return dealerId;
}

function requireAdmin(request: Request, env: Env): Response | null {
  if (!checkAdminAuth(request, env)) {
    return json({ error: "Password de administrador inválida." }, { status: 401 });
  }
  return null;
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return json({});

    // ---------- health ----------
    if (path === "/health") return json({ ok: true, service: "peca-troca" });

    // ---------- registo ----------
    if (path === "/api/dealers/register" && request.method === "POST") {
      const body = await request.json<any>().catch(() => null);
      if (!body?.companyName || !body?.phone) {
        return json({ error: "Nome da empresa e telefone são obrigatórios." }, { status: 400 });
      }
      if (!body?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        return json({ error: "Email válido é obrigatório." }, { status: 400 });
      }

      // Password de registo: só bloqueia se o admin tiver definido uma
      // no painel. Vazio/não definido = registo aberto, como sempre foi.
      const registrationPassword = await env.DB
        .prepare("SELECT value FROM settings WHERE key = 'registration_password'")
        .first<{ value: string | null }>();

      if (registrationPassword?.value && registrationPassword.value.trim() !== "") {
        if (body?.registrationPassword !== registrationPassword.value) {
          return json({ error: "Código de acesso inválido. Verifica o email de apresentação da plataforma." }, { status: 403 });
        }
      }

      const phoneNormalized = normalizePhone(body.phone);
      if (phoneNormalized.length < 9) {
        return json({ error: "Telefone inválido." }, { status: 400 });
      }

      const verification = await verifyAgainstOfficialList(env.DB, {
        companyName: body.companyName,
        phone: body.phone,
        city: body.city,
        postalCode: body.postalCode,
      });

      // Só bloqueia como duplicado se já existir uma conta com o mesmo
      // telefone E a apontar para a mesma loja oficial. Cadeias como
      // Carby/Santogal partilham central telefónica entre lojas
      // diferentes (ex: Carlos Alberto Faial e Pico) — nesse caso o
      // código postal já desempatou para uma official_dealer_id
      // diferente, por isso é um registo legítimo, não duplicado.
      const existingSameStore = await env.DB
        .prepare(
          `SELECT id FROM dealers
           WHERE phone_normalized = ?
             AND (official_dealer_id = ? OR (official_dealer_id IS NULL AND ? IS NULL))`
        )
        .bind(phoneNormalized, verification.officialDealerId, verification.officialDealerId)
        .first<{ id: number }>();

      if (existingSameStore) {
        return json({ error: "Já existe uma conta registada com este telefone para esta loja. Usa o login." }, { status: 409 });
      }

      const result = await env.DB
        .prepare(
          `INSERT INTO dealers
            (company_name, contact_name, phone, phone_normalized, email, email_confirmed,
             address, postal_code, city, official_dealer_id, verified, verification_method)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          body.companyName,
          body.contactName || null,
          body.phone,
          phoneNormalized,
          body.email,
          body.address || null,
          body.postalCode || null,
          body.city || null,
          verification.officialDealerId,
          verification.verified ? 1 : 0,
          verification.method
        )
        .run();

      const dealerId = result.meta.last_row_id;

      // O email só fica ativo para login depois de confirmado. Gera-se já
      // o primeiro código de confirmação, para o frontend pedir logo a
      // seguir ao registo — evita um passo extra de "pedir código".
      const confirmationCode = await createLoginCode(env.DB, dealerId as number);

      return json({
        dealerId,
        verified: verification.verified,
        needsEmailConfirmation: true,
        message: verification.verified
          ? "Registo confirmado automaticamente contra a lista oficial Renault. Falta só confirmar o email."
          : "Registo criado. A tua conta fica pendente de confirmação manual — vamos verificar os teus dados brevemente. Entretanto, confirma o email.",
        devCode: confirmationCode, // REMOVER quando o envio por email estiver ligado
      });
    }

    // ---------- sugestões de nome (autocomplete no registo) ----------
    if (path === "/api/dealers/suggest" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length < 2) return json({ results: [] });

      const qNormalized = normalizeText(q);
      const rows = await env.DB
        .prepare(
          `SELECT company_name, city, postal_code, phone
           FROM official_dealers
           WHERE company_name_normalized LIKE ?
           ORDER BY company_name
           LIMIT 8`
        )
        .bind(`%${qNormalized}%`)
        .all();

      return json({ results: rows.results || [] });
    }

    // ---------- confirmar email (primeira vez, logo após o registo) ----------
    if (path === "/api/dealers/confirm-email" && request.method === "POST") {
      const body = await request.json<any>().catch(() => null);
      if (!body?.dealerId || !body?.code) {
        return json({ error: "dealerId e code são obrigatórios." }, { status: 400 });
      }

      const dealer = await env.DB
        .prepare("SELECT login_token, login_token_expires_at FROM dealers WHERE id = ?")
        .bind(body.dealerId)
        .first<{ login_token: string | null; login_token_expires_at: string | null }>();

      if (!dealer || dealer.login_token !== String(body.code)) {
        return json({ error: "Código inválido." }, { status: 401 });
      }
      if (!dealer.login_token_expires_at || new Date(dealer.login_token_expires_at) < new Date()) {
        return json({ error: "Código expirado. Pede um novo em 'Entrar'." }, { status: 401 });
      }

      await env.DB
        .prepare("UPDATE dealers SET email_confirmed = 1 WHERE id = ?")
        .bind(body.dealerId)
        .run();

      const sessionToken = await redeemLoginCode(env.DB, body.dealerId, String(body.code));
      return json({ message: "Email confirmado.", sessionToken });
    }

    // ---------- pedir código de login ----------
    if (path === "/api/auth/request-code" && request.method === "POST") {
      const body = await request.json<any>().catch(() => null);
      if (!body?.phone || !body?.email) {
        return json({ error: "Telefone e email são obrigatórios." }, { status: 400 });
      }

      // Login exige telefone + email juntos, não só telefone. Algumas
      // cadeias (Carby, Santogal) partilham o mesmo telefone de central
      // entre lojas diferentes — só o email é garantidamente único por
      // conta (índice UNIQUE), por isso é preciso os dois para saber
      // exatamente a que loja a pessoa se refere.
      const phoneNormalized = normalizePhone(body.phone);
      const emailNormalized = String(body.email).trim().toLowerCase();
      const dealer = await env.DB
        .prepare("SELECT id, email_confirmed FROM dealers WHERE phone_normalized = ? AND lower(email) = ?")
        .bind(phoneNormalized, emailNormalized)
        .first<{ id: number; email_confirmed: number }>();

      if (!dealer) {
        return json({ error: "Não encontrámos nenhuma conta com este telefone e email." }, { status: 404 });
      }

      const code = await createLoginCode(env.DB, dealer.id);

      // NOTA DE IMPLEMENTAÇÃO: falta ligar a um serviço real de email
      // (ex: Resend). Por agora devolve-se o código na resposta
      // para testar o fluxo end-to-end sem essa integração.
      return json({
        dealerId: dealer.id,
        needsEmailConfirmation: !dealer.email_confirmed,
        message: "Código gerado.",
        devCode: code, // REMOVER quando o envio por email estiver ligado
      });
    }

    // ---------- trocar código por sessão ----------
    if (path === "/api/auth/redeem-code" && request.method === "POST") {
      const body = await request.json<any>().catch(() => null);
      if (!body?.dealerId || !body?.code) {
        return json({ error: "dealerId e code são obrigatórios." }, { status: 400 });
      }

      const sessionToken = await redeemLoginCode(env.DB, body.dealerId, String(body.code));
      if (!sessionToken) return json({ error: "Código inválido ou expirado." }, { status: 401 });

      return json({ sessionToken });
    }

    // ---------- dados do concessionário autenticado ----------
    if (path === "/api/dealers/me" && request.method === "GET") {
      const dealerIdOrResponse = await requireDealer(request, env);
      if (dealerIdOrResponse instanceof Response) return dealerIdOrResponse;

      const dealer = await env.DB
        .prepare(
          `SELECT id, company_name, contact_name, phone, email, address, postal_code, city, verified
           FROM dealers WHERE id = ?`
        )
        .bind(dealerIdOrResponse)
        .first();

      return json({ dealer });
    }

    // ---------- publicar peça ----------
    if (path === "/api/listings" && request.method === "POST") {
      const dealerIdOrResponse = await requireDealer(request, env);
      if (dealerIdOrResponse instanceof Response) return dealerIdOrResponse;
      const dealerId = dealerIdOrResponse;

      const body = await request.json<any>().catch(() => null);
      if (!body?.reference) return json({ error: "Referência é obrigatória." }, { status: 400 });

      const referenceNormalized = normalizeReference(body.reference);
      if (referenceNormalized.length < 3) {
        return json({ error: "Referência demasiado curta." }, { status: 400 });
      }

      const result = await env.DB
        .prepare(
          `INSERT INTO parts_listings
            (dealer_id, reference, reference_normalized, description, quantity, brand, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          dealerId,
          body.reference,
          referenceNormalized,
          body.description || null,
          Number(body.quantity) || 1,
          body.brand === "dacia" ? "dacia" : "renault",
          body.notes || null
        )
        .run();

      return json({ listingId: result.meta.last_row_id, message: "Peça publicada." });
    }

    // ---------- atualizar peça (quantidade, estado) ----------
    const patchMatch = path.match(/^\/api\/listings\/(\d+)$/);
    if (patchMatch && request.method === "PATCH") {
      const dealerIdOrResponse = await requireDealer(request, env);
      if (dealerIdOrResponse instanceof Response) return dealerIdOrResponse;
      const dealerId = dealerIdOrResponse;
      const listingId = Number(patchMatch[1]);

      const listing = await env.DB
        .prepare("SELECT dealer_id, quantity FROM parts_listings WHERE id = ?")
        .bind(listingId)
        .first<{ dealer_id: number; quantity: number }>();

      if (!listing) return json({ error: "Anúncio não encontrado." }, { status: 404 });
      if (listing.dealer_id !== dealerId) {
        return json({ error: "Não podes editar um anúncio que não é teu." }, { status: 403 });
      }

      const body = await request.json<any>().catch(() => null);

      // Ajustar quantidade (ex: "vendi 1 das 2 que tinha"). Se chegar a
      // 0, marca automaticamente como vendida — não fica active com
      // quantidade 0 a aparecer nas pesquisas.
      if (typeof body?.quantity === "number") {
        const newQuantity = Math.max(0, Math.floor(body.quantity));
        const newStatus = newQuantity === 0 ? "sold" : "active";
        await env.DB
          .prepare("UPDATE parts_listings SET quantity = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(newQuantity, newStatus, listingId)
          .run();
        return json({ message: "Quantidade atualizada.", quantity: newQuantity, status: newStatus });
      }

      // Editar descrição e/ou notas (ex: corrigir erro de escrita,
      // acrescentar "já reservada para cliente X"). Só atualiza os
      // campos que vierem no pedido — não sobrescreve o outro com null.
      if (typeof body?.description === "string" || typeof body?.notes === "string") {
        const current = await env.DB
          .prepare("SELECT description, notes FROM parts_listings WHERE id = ?")
          .bind(listingId)
          .first<{ description: string | null; notes: string | null }>();

        const newDescription = typeof body.description === "string" ? body.description : current?.description ?? null;
        const newNotes = typeof body.notes === "string" ? body.notes : current?.notes ?? null;

        await env.DB
          .prepare("UPDATE parts_listings SET description = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(newDescription, newNotes, listingId)
          .run();
        return json({ message: "Descrição e notas atualizadas." });
      }

      // Ou atualizar o estado diretamente (ex: marcar vendida sem
      // mexer na quantidade, ou reativar um anúncio).
      const status = body?.status;
      if (!["active", "sold", "removed"].includes(status)) {
        return json({ error: "Estado inválido. Usa: active, sold, removed." }, { status: 400 });
      }

      await env.DB
        .prepare("UPDATE parts_listings SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(status, listingId)
        .run();

      return json({ message: "Anúncio atualizado." });
    }

    // ---------- eliminar peça definitivamente ----------
    if (patchMatch && request.method === "DELETE") {
      const dealerIdOrResponse = await requireDealer(request, env);
      if (dealerIdOrResponse instanceof Response) return dealerIdOrResponse;
      const dealerId = dealerIdOrResponse;
      const listingId = Number(patchMatch[1]);

      const listing = await env.DB
        .prepare("SELECT dealer_id FROM parts_listings WHERE id = ?")
        .bind(listingId)
        .first<{ dealer_id: number }>();

      if (!listing) return json({ error: "Anúncio não encontrado." }, { status: 404 });
      if (listing.dealer_id !== dealerId) {
        return json({ error: "Não podes eliminar um anúncio que não é teu." }, { status: 403 });
      }

      await env.DB.prepare("DELETE FROM parts_listings WHERE id = ?").bind(listingId).run();
      return json({ message: "Anúncio eliminado." });
    }

    // ---------- pesquisar por referência ----------
    // ---------- listar todas as peças ativas (sem pesquisa) ----------
    if (path === "/api/listings/browse" && request.method === "GET") {
      const rows = await env.DB
        .prepare(
          `SELECT
             pl.id, pl.reference, pl.description, pl.quantity, pl.brand, pl.notes, pl.created_at,
             d.company_name, d.phone, d.email, d.city, d.postal_code, d.verified
           FROM parts_listings pl
           JOIN dealers d ON d.id = pl.dealer_id
           WHERE pl.status = 'active'
           ORDER BY pl.created_at DESC
           LIMIT 100`
        )
        .all();

      return json({ results: rows.results || [] });
    }

    if (path === "/api/listings/search" && request.method === "GET") {
      const ref = url.searchParams.get("ref") || "";
      const refNormalized = normalizeReference(ref);
      if (refNormalized.length < 2) {
        return json({ error: "Indica pelo menos 2 caracteres da referência." }, { status: 400 });
      }

      const rows = await env.DB
        .prepare(
          `SELECT
             pl.id, pl.reference, pl.description, pl.quantity, pl.brand, pl.notes, pl.created_at,
             d.company_name, d.phone, d.email, d.city, d.postal_code, d.verified
           FROM parts_listings pl
           JOIN dealers d ON d.id = pl.dealer_id
           WHERE pl.reference_normalized LIKE ? AND pl.status = 'active'
           ORDER BY pl.created_at DESC
           LIMIT 50`
        )
        .bind(`%${refNormalized}%`)
        .all();

      return json({ results: rows.results || [] });
    }

    // ---------- listagens do próprio concessionário ----------
    if (path === "/api/listings/mine" && request.method === "GET") {
      const dealerIdOrResponse = await requireDealer(request, env);
      if (dealerIdOrResponse instanceof Response) return dealerIdOrResponse;

      const rows = await env.DB
        .prepare(
          `SELECT id, reference, description, quantity, brand, notes, status, created_at
           FROM parts_listings WHERE dealer_id = ? ORDER BY created_at DESC`
        )
        .bind(dealerIdOrResponse)
        .all();

      return json({ results: rows.results || [] });
    }

    // ---------- subscrever alerta ----------
    if (path === "/api/alerts" && request.method === "POST") {
      const dealerIdOrResponse = await requireDealer(request, env);
      if (dealerIdOrResponse instanceof Response) return dealerIdOrResponse;
      const dealerId = dealerIdOrResponse;

      const body = await request.json<any>().catch(() => null);
      if (!body?.reference) return json({ error: "Referência é obrigatória." }, { status: 400 });

      const referenceNormalized = normalizeReference(body.reference);
      await env.DB
        .prepare("INSERT INTO reference_alerts (dealer_id, reference_normalized) VALUES (?, ?)")
        .bind(dealerId, referenceNormalized)
        .run();

      return json({ message: "Alerta criado. Avisamos-te quando alguém publicar essa referência." });
    }

    // ---------- alertas do próprio concessionário ----------
    if (path === "/api/alerts/mine" && request.method === "GET") {
      const dealerIdOrResponse = await requireDealer(request, env);
      if (dealerIdOrResponse instanceof Response) return dealerIdOrResponse;

      const rows = await env.DB
        .prepare(
          `SELECT id, reference_normalized, created_at, notified_at
           FROM reference_alerts WHERE dealer_id = ? ORDER BY created_at DESC`
        )
        .bind(dealerIdOrResponse)
        .all();

      return json({ results: rows.results || [] });
    }

    // ============================================================
    // Painel de administrador — todas as rotas abaixo exigem
    // header x-admin-password correto.
    // ============================================================

    if (path.startsWith("/api/admin/")) {
      const authError = requireAdmin(request, env);
      if (authError) return authError;
    }

    // ---------- estatísticas rápidas ----------
    if (path === "/api/admin/stats" && request.method === "GET") {
      const [dealerCounts, listingCounts, recentListings, pendingDealers] = await Promise.all([
        env.DB.prepare(
          "SELECT COUNT(*) AS total, SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) AS verified FROM dealers"
        ).first<{ total: number; verified: number }>(),
        env.DB.prepare(
          "SELECT COUNT(*) AS total FROM parts_listings WHERE status = 'active'"
        ).first<{ total: number }>(),
        env.DB.prepare(
          "SELECT COUNT(*) AS total FROM parts_listings WHERE created_at >= datetime('now', '-7 days')"
        ).first<{ total: number }>(),
        env.DB.prepare(
          "SELECT COUNT(*) AS total FROM dealers WHERE verified = 0"
        ).first<{ total: number }>(),
      ]);

      return json({
        totalDealers: dealerCounts?.total || 0,
        verifiedDealers: dealerCounts?.verified || 0,
        pendingDealers: pendingDealers?.total || 0,
        activeListings: listingCounts?.total || 0,
        listingsLast7Days: recentListings?.total || 0,
      });
    }

    // ---------- listar todos os concessionários ----------
    if (path === "/api/admin/dealers" && request.method === "GET") {
      const rows = await env.DB
        .prepare(
          `SELECT id, company_name, contact_name, phone, email, email_confirmed,
                  city, postal_code, verified, verification_method, created_at, last_login_at
           FROM dealers ORDER BY created_at DESC`
        )
        .all();
      return json({ results: rows.results || [] });
    }

    // ---------- editar um concessionário ----------
    const adminDealerMatch = path.match(/^\/api\/admin\/dealers\/(\d+)$/);
    if (adminDealerMatch && request.method === "PATCH") {
      const dealerId = Number(adminDealerMatch[1]);
      const body = await request.json<any>().catch(() => null);
      if (!body) return json({ error: "Corpo do pedido inválido." }, { status: 400 });

      const fields: string[] = [];
      const values: any[] = [];

      if (typeof body.companyName === "string") { fields.push("company_name = ?"); values.push(body.companyName); }
      if (typeof body.contactName === "string") { fields.push("contact_name = ?"); values.push(body.contactName); }
      if (typeof body.phone === "string") {
        fields.push("phone = ?", "phone_normalized = ?");
        values.push(body.phone, normalizePhone(body.phone));
      }
      if (typeof body.email === "string") { fields.push("email = ?"); values.push(body.email); }
      if (typeof body.city === "string") { fields.push("city = ?"); values.push(body.city); }
      if (typeof body.postalCode === "string") { fields.push("postal_code = ?"); values.push(body.postalCode); }
      if (typeof body.verified === "boolean") { fields.push("verified = ?"); values.push(body.verified ? 1 : 0); }
      if (typeof body.emailConfirmed === "boolean") { fields.push("email_confirmed = ?"); values.push(body.emailConfirmed ? 1 : 0); }

      if (fields.length === 0) return json({ error: "Nada para atualizar." }, { status: 400 });

      values.push(dealerId);
      await env.DB.prepare(`UPDATE dealers SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
      return json({ message: "Concessionário atualizado." });
    }

    // ---------- eliminar um concessionário (e as suas peças) ----------
    if (adminDealerMatch && request.method === "DELETE") {
      const dealerId = Number(adminDealerMatch[1]);
      await env.DB.prepare("DELETE FROM parts_listings WHERE dealer_id = ?").bind(dealerId).run();
      await env.DB.prepare("DELETE FROM reference_alerts WHERE dealer_id = ?").bind(dealerId).run();
      await env.DB.prepare("DELETE FROM dealers WHERE id = ?").bind(dealerId).run();
      return json({ message: "Concessionário e respetivas peças eliminados." });
    }

    // ---------- listar todas as peças (qualquer estado) ----------
    if (path === "/api/admin/listings" && request.method === "GET") {
      const rows = await env.DB
        .prepare(
          `SELECT pl.id, pl.reference, pl.description, pl.quantity, pl.brand, pl.notes,
                  pl.status, pl.created_at, pl.updated_at,
                  d.id AS dealer_id, d.company_name
           FROM parts_listings pl
           JOIN dealers d ON d.id = pl.dealer_id
           ORDER BY pl.created_at DESC`
        )
        .all();
      return json({ results: rows.results || [] });
    }

    // ---------- editar qualquer peça ----------
    const adminListingMatch = path.match(/^\/api\/admin\/listings\/(\d+)$/);
    if (adminListingMatch && request.method === "PATCH") {
      const listingId = Number(adminListingMatch[1]);
      const body = await request.json<any>().catch(() => null);
      if (!body) return json({ error: "Corpo do pedido inválido." }, { status: 400 });

      const fields: string[] = [];
      const values: any[] = [];

      if (typeof body.reference === "string") {
        fields.push("reference = ?", "reference_normalized = ?");
        values.push(body.reference, normalizeReference(body.reference));
      }
      if (typeof body.description === "string") { fields.push("description = ?"); values.push(body.description); }
      if (typeof body.notes === "string") { fields.push("notes = ?"); values.push(body.notes); }
      if (typeof body.quantity === "number") { fields.push("quantity = ?"); values.push(Math.max(0, Math.floor(body.quantity))); }
      if (typeof body.status === "string" && ["active", "sold", "removed"].includes(body.status)) {
        fields.push("status = ?"); values.push(body.status);
      }

      if (fields.length === 0) return json({ error: "Nada para atualizar." }, { status: 400 });

      fields.push("updated_at = datetime('now')");
      values.push(listingId);
      await env.DB.prepare(`UPDATE parts_listings SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
      return json({ message: "Peça atualizada." });
    }

    // ---------- eliminar qualquer peça ----------
    if (adminListingMatch && request.method === "DELETE") {
      const listingId = Number(adminListingMatch[1]);
      await env.DB.prepare("DELETE FROM parts_listings WHERE id = ?").bind(listingId).run();
      return json({ message: "Peça eliminada." });
    }

    // ---------- ler configurações ----------
    if (path === "/api/admin/settings" && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT key, value, updated_at FROM settings").all();
      return json({ results: rows.results || [] });
    }

    // ---------- alterar uma configuração ----------
    const settingMatch = path.match(/^\/api\/admin\/settings\/([a-z_]+)$/);
    if (settingMatch && request.method === "PUT") {
      const key = settingMatch[1];
      const body = await request.json<any>().catch(() => null);
      if (typeof body?.value !== "string") return json({ error: "Campo 'value' é obrigatório." }, { status: 400 });

      await env.DB
        .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(key, body.value)
        .run();
      return json({ message: "Configuração atualizada." });
    }

    return json({ error: "Rota não encontrada." }, { status: 404 });
  },
};
