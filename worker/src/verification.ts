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
 * Regra: telefone exato = validação automática, MAS com uma ressalva
 * importante — algumas cadeias (ex: Carby, Santogal) usam a mesma
 * central telefónica para várias lojas em cidades diferentes. Um match
 * de telefone que aponte para mais do que uma loja não pode escolher
 * uma ao acaso, ou fica a loja errada associada à conta.
 *
 * Nesse caso, o telefone sozinho só confirma "és desta cadeia", e usa-se
 * o código postal para desempatar qual loja exata. Se não vier código
 * postal, ou se não bater com nenhuma das lojas do grupo, fica pendente
 * para confirmação manual — mas já fica corretamente marcado como
 * "telefone da cadeia confirmado", que informa a revisão manual.
 *
 * Se o telefone não bater com nada, tenta por nome com tolerância a
 * pequenas diferenças de grafia. Nome semelhante sozinho não chega a
 * "verified" — fica pendente, porque nomes podem colidir por coincidência.
 */
export async function verifyAgainstOfficialList(
  db: D1Database,
  input: { companyName: string; phone: string; city?: string; postalCode?: string }
): Promise<VerificationResult> {
  const phoneNorm = normalizePhone(input.phone);
  const nameNorm = normalizeText(input.companyName);

  if (phoneNorm) {
    const byPhone = await db
      .prepare("SELECT id, company_name, postal_code FROM official_dealers WHERE phone_normalized = ?")
      .bind(phoneNorm)
      .all<{ id: number; company_name: string; postal_code: string | null }>();

    const matches = byPhone.results || [];

    if (matches.length === 1) {
      // Telefone único na lista — sem ambiguidade, valida direto.
      return {
        verified: true,
        method: "auto_match",
        officialDealerId: matches[0].id,
        matchedOn: ["phone"],
        confidence: 1,
      };
    }

    if (matches.length > 1) {
      // Telefone partilhado por várias lojas da mesma cadeia — desempata
      // por código postal, para não associar à loja errada.
      const postalNorm = (input.postalCode || "").trim().slice(0, 4); // primeiros 4 dígitos chegam
      const exact = postalNorm
        ? matches.find((m) => (m.postal_code || "").trim().startsWith(postalNorm))
        : undefined;

      if (exact) {
        return {
          verified: true,
          method: "auto_match",
          officialDealerId: exact.id,
          matchedOn: ["phone", "postal_code"],
          confidence: 1,
        };
      }

      // Telefone da cadeia confere, mas não sabemos qual loja exata —
      // fica pendente para um humano escolher, em vez de adivinhar.
      return {
        verified: false,
        method: "manual",
        officialDealerId: matches[0].id, // sugestão, não confirmação
        matchedOn: ["phone_shared"],
        confidence: 0.5,
      };
    }
  }

  // Sem match de telefone: procura candidatos por nome semelhante.
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

  return {
    verified: false,
    method: null,
    officialDealerId: null,
    matchedOn: [],
    confidence: 0,
  };
}
