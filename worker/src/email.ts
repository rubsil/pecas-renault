// worker/src/email.ts
// Envio de email via Gmail API (não SMTP -- Workers não conseguem
// falar SMTP diretamente, só HTTP). Usa uma conta Gmail dedicada,
// autorizada uma única vez via OAuth2 (ver NOTES_gmail_api_setup.md);
// o refresh token gerado nesse processo nunca expira (com a app em
// modo "In production" e scope gmail.send, que não é scope
// "restricted"), por isso isto funciona para sempre sem intervenção
// manual depois de configurado.
//
// Secrets necessários no Worker (wrangler secret put):
//   GMAIL_CLIENT_ID
//   GMAIL_CLIENT_SECRET
//   GMAIL_REFRESH_TOKEN
//   GMAIL_SENDER_EMAIL   (o email da conta Gmail dedicada)

export interface GmailEnv {
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_SENDER_EMAIL?: string;
}

/** Confirma que os 4 secrets necessários estão definidos, antes de
 *  tentar usá-los -- evita erros confusos a meio do fluxo de envio. */
export function gmailConfigured(env: GmailEnv): boolean {
  return !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_SENDER_EMAIL);
}

/**
 * Troca o refresh token por um access token novo (válido ~1 hora).
 * Chamado sempre que precisamos de enviar um email -- gerar um novo
 * de cada vez é mais simples e seguro do que tentar cachear entre
 * pedidos diferentes do Worker (que não partilham memória).
 *
 * Exportada porque também é chamada isoladamente pelo Cron Trigger
 * (ver scheduled() em index.ts) só para "manter vivo" o refresh
 * token -- a Google invalida-o se não for usado durante 6 meses
 * seguidos, e esta troca em si já conta como uso.
 */
export async function getAccessToken(env: GmailEnv): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID!,
      client_secret: env.GMAIL_CLIENT_SECRET!,
      refresh_token: env.GMAIL_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Falha ao renovar token Gmail (${res.status}): ${body}`);
  }

  const data = await res.json<{ access_token: string }>();
  return data.access_token;
}

/** Codifica em base64url (Gmail API exige isto, não base64 normal --
 *  diferem nos caracteres '+', '/' e no padding '='). */
function base64UrlEncode(str: string): string {
  // btoa não lida bem com UTF-8 diretamente; passa primeiro por
  // encodeURIComponent para preservar acentos (nomes, assuntos em
  // português) sem corromper caracteres.
  const utf8Safe = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return btoa(utf8Safe).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Envia um email de texto simples via Gmail API. Lança erro se os
 * secrets não estiverem configurados ou se a API devolver falha --
 * quem chama deve tratar isso (normalmente: cair de volta para o
 * devCode visível, nunca bloquear o registo por causa disto).
 */
export async function sendEmail(
  env: GmailEnv,
  to: string,
  subject: string,
  body: string
): Promise<void> {
  if (!gmailConfigured(env)) {
    throw new Error("Envio de email não configurado (faltam secrets GMAIL_*).");
  }

  const accessToken = await getAccessToken(env);

  const message = [
    `From: Stock Rede Renault <${env.GMAIL_SENDER_EMAIL}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");

  const raw = base64UrlEncode(message);

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Falha ao enviar email (${res.status}): ${errBody}`);
  }
}

/** Texto padrão do email de código de confirmação/login -- usado
 *  tanto no registo inicial como em logins seguintes. */
export function buildVerificationEmailBody(code: string): string {
  return [
    "Olá,",
    "",
    "O teu código de acesso à Stock Rede Renault é:",
    "",
    code,
    "",
    "Este código é válido por 15 minutos.",
    "",
    "Se não pediste este código, ignora este email.",
    "",
    "— Stock Rede Renault",
  ].join("\n");
}
