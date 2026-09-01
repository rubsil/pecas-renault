// worker/src/verification.ts
// Cruza um registo novo contra a tabela official_dealers para
// decidir se pode ser verificado automaticamente.

import { normalizePhone, normalizeText, similarity } from "./normalize";

export interface VerificationResult {
  verified: boolean;
  method: "auto_match" | "manual" | null;
  officialDealerId: number | null;
  matchedOn: string[];       // ex: ["phone"], ["name"], ["phone", "name"]
  confidence: number;        // 0-1
}

/**
 * Tenta validar um concessionário novo contra a lista oficial.
 *
 * Regra: telefone exato = validação automática imediata (o telefone
 * é o identificador mais difícil de forjar em massa, porque é público
 * e verificável por chamada).
 *
 * Se o telefone não bater certo, tenta por nome com tolerância a
 * pequenas diferenças de grafia (maiúsculas, pontuação, abreviaturas).
 * Nome semelhante sozinho não chega a "verified" — fica pendente
 * para confirmação manual, porque nomes podem colidir por coincidência.
 */
export async function verifyAgainstOfficialList(
  db: D1Database,
  input: { companyName: string; phone: string; city?: string }
): Promise<VerificationResult> {
  const phoneNorm = normalizePhone(input.phone);
  const nameNorm = normalizeText(input.companyName);

  // 1. Match exato por telefone — mais forte, decide sozinho.
  if (phoneNorm) {
    const byPhone = await db
      .prepare("SELECT id, company_name FROM official_dealers WHERE phone_normalized = ?")
      .bind(phoneNorm)
      .first<{ id: number; company_name: string }>();

    if (byPhone) {
      return {
        verified: true,
        method: "auto_match",
        officialDealerId: byPhone.id,
        matchedOn: ["phone"],
        confidence: 1,
      };
    }
  }

  // 2. Sem match de telefone: procura candidatos por nome semelhante.
  //    Não valida automaticamente — fica para revisão manual, mas já
  //    liga ao registo mais provável para facilitar essa revisão.
  const candidates = await db
    .prepare("SELECT id, company_name FROM official_dealers")
    .all<{ id: number; company_name: string }>();

  let best: { id: number; company_name: string; score: number } | null = null;
  for (const row of candidates.results || []) {
    const score = similarity(nameNorm, row.company_name);
    if (!best || score > best.score) {
      best = { ...row, score };
    }
  }

  if (best && best.score >= 0.75) {
    return {
      verified: false,
      method: "manual",
      officialDealerId: best.id,
      matchedOn: ["name"],
      confidence: best.score,
    };
  }

  // 3. Nada de jeito encontrado — fica mesmo pendente, sem sugestão.
  return {
    verified: false,
    method: null,
    officialDealerId: null,
    matchedOn: [],
    confidence: 0,
  };
}
