// worker/src/password.ts
//
// Hashing de password com PBKDF2 (Web Crypto API nativo do Workers,
// sem dependências externas). Nunca se guarda a password em texto
// simples -- só o hash derivado + o salt aleatório usado.
//
// 100.000 iterações é o limite prático do crypto.subtle em Cloudflare
// Workers (valores mais altos são bloqueados pela própria plataforma,
// por proteção contra DoS) -- ligeiramente abaixo do recomendado pelo
// OWASP em 2023 para uso geral (210.000+), mas muito acima de não ter
// proteção nenhuma, e adequado ao volume/perfil de risco deste projeto.
const PBKDF2_ITERATIONS = 100000;

/**
 * Deriva um hash de password com PBKDF2-SHA256. Gera um salt novo e
 * aleatório sempre que é chamada -- nunca reutilizar o mesmo salt
 * entre contas ou entre trocas de password da mesma conta.
 *
 * Devolve { hash, salt }, ambos como string hexadecimal, para gravar
 * diretamente em colunas TEXT na D1.
 */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, salt);
  return { hash: bufferToHex(hash), salt: bufferToHex(salt) };
}

/**
 * Confirma se a password fornecida corresponde ao hash/salt já
 * guardados. Deriva o hash da mesma forma (mesmo salt) e compara.
 */
export async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
  const salt = hexToBuffer(storedSalt);
  const hash = await deriveHash(password, salt);
  return bufferToHex(hash) === storedHash;
}

async function deriveHash(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256 // bits -- 32 bytes de saída
  );
}

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
