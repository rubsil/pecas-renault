// worker/src/normalize.ts
// Funções de normalização usadas para matching e pesquisa.
// Mantidas simples e sem dependências externas.

/** Remove acentos, baixa para minúsculas, colapsa espaços. Para nomes/moradas. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Mantém só dígitos e remove o indicativo de Portugal (351), com ou sem
 * prefixo 00/+, para que "21 937 1206" e "+351 219 371 206" normalizem
 * para o mesmo valor. Sem isto, a validação automática contra a lista
 * oficial falha sempre que alguém escreve o número com indicativo.
 */
export function normalizePhone(value: string): string {
  let digits = (value || "").replace(/\D+/g, "");
  if (digits.startsWith("00351")) digits = digits.slice(5);
  else if (digits.startsWith("351") && digits.length > 9) digits = digits.slice(3);
  return digits;
}

/** Maiúsculas, sem espaços/hífens/pontos. Para referências de peças. */
export function normalizeReference(value: string): string {
  return (value || "")
    .toUpperCase()
    .replace(/[\s\-.\/]+/g, "");
}

/** Distância de Levenshtein simples, para permitir pequenas diferenças de grafia. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/** Similaridade 0-1 baseada em Levenshtein, para matching tolerante de nomes. */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}
