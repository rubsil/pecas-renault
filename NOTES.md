# Notas operacionais (uso interno)

Este ficheiro é o manual de trabalho do projeto — deploy, migrações,
comandos, decisões técnicas do dia-a-dia. Não é pensado para quem só
visita o repositório; é para quem mexe nele.

## Estrutura real do projeto

```
pecas-renault/
├── worker/                    Cloudflare Worker (API) + D1
│   ├── src/
│   │   ├── index.ts             rotas da API
│   │   ├── normalize.ts         normalização de texto/telefone/referência
│   │   ├── verification.ts      validação contra lista oficial
│   │   ├── auth.ts              login por código (magic link)
│   │   └── admin.ts             autenticação do painel de admin
│   ├── migrations/              migrações SQL, numeradas por ordem
│   ├── schema.sql               schema completo (para instalação de raiz)
│   └── wrangler.toml            configuração de deploy
├── docs/                       Frontend estático (GitHub Pages)
│   ├── index.html                pesquisa de peças
│   ├── conta.html                 registo / login / dashboard
│   └── publicar.html              publicar peça
├── data/
│   ├── dealers_page1-4.json     lista oficial de concessionários (97 no total)
│   └── import_dealers.sql       SQL gerado, pronto a importar
└── scripts/
    └── import_dealers.py        gera o SQL de importação a partir dos JSON
```

## Deploy — passo a passo (primeira instalação)

### 1. Criar a base de dados D1

```bash
cd worker
wrangler d1 create peca-troca-db
```

Copia o `database_id` que aparece no output e cola em `wrangler.toml`.

### 2. Aplicar o schema

```bash
wrangler d1 execute peca-troca-db --file=schema.sql --remote
```

### 3. Importar a lista oficial de concessionários

```bash
python3 scripts/import_dealers.py
wrangler d1 execute peca-troca-db --file=data/import_dealers.sql --remote
```

Seguro correr mais do que uma vez — cada INSERT é independente. Para
evitar duplicados ao reimportar, limpar a tabela antes:
```bash
wrangler d1 execute peca-troca-db --command="DELETE FROM official_dealers" --remote
```

### 4. Deploy do Worker

```bash
cd worker
wrangler deploy
```

Dá um URL do género `https://pecas-renault.<subdomínio>.workers.dev`.

### 5. Ligar o frontend ao Worker

Em cada ficheiro HTML de `docs/`, confirmar:

```js
const API_BASE = "https://pecas-renault.ruben-silva-92.workers.dev";
```

### 6. GitHub Pages

Já configurado — qualquer `git push` para `docs/` atualiza o site em
1-2 minutos. Se for preciso reconfigurar: definições do repositório
→ Pages → pasta `docs/`.

### 7. Definir o secret ADMIN_PASSWORD

**Usar sempre `wrangler secret put`, nunca o dashboard Cloudflare:**

```bash
cd worker
wrangler secret put ADMIN_PASSWORD
```

> **Porquê não o dashboard.** Definir o secret em Workers & Pages →
> Settings → Variables and Secrets pareceu funcionar mas foi apagado
> silenciosamente no deploy seguinte feito pelo Workers Builds (bug
> conhecido da integração Git da Cloudflare — o CI limpa secrets
> definidos manualmente a cada novo push). O sintoma é "password
> inválida" mesmo com o valor certo, sem erro nenhum a apontar para a
> causa real. `wrangler secret put` grava diretamente na versão
> publicada do Worker, sem depender do processo de build do GitHub —
> sobrevive a pushes seguintes sem se perder.

Sem este secret definido, o painel de administrador fica sempre
bloqueado (comportamento seguro por omissão).

## Migrações pendentes de aplicar

Sempre que houver uma migração nova em `worker/migrations/`, aplicar
manualmente na consola D1 do dashboard Cloudflare (Workers & Pages →
D1 → `peca-troca-db` → Console). Histórico:

- `0001_email_confirmation.sql` — coluna `email_confirmed`
- `0002_settings_table.sql` — tabela `settings` (password de registo)
- `0003_remove_reserved_status.sql` — remove estado `reserved`
- `0004_dealer_verified_at.sql` — coluna `verified_at`
- `0005_admin_activity_log.sql` — tabela `admin_activity_log`
- `0006_listing_alt_references.sql` — tabela `listing_alt_references`
- `0007_official_dealers_coordinates.sql` — colunas `lat`/`lon`/`geocoded_at` na lista oficial

## Correções manuais na base de dados

Volume de concessionários pequeno — correções pontuais fazem-se
diretamente na consola D1, sem precisar do painel de admin. Exemplo,
corrigir um email mal escrito:

```sql
UPDATE dealers SET email = 'email-correto@exemplo.pt', email_confirmed = 0 WHERE phone_normalized = '292240200';
```

`email_confirmed = 0` obriga a nova confirmação, para garantir que o
email corrigido é mesmo válido antes de voltar a servir para login.

## Envio de email real via Gmail API

**Concluído e testado** — o código de confirmação/login já é enviado
por email a sério, usando a Gmail API (não Resend — decidido não
pagar domínio próprio, ver histórico de conversa). Implementado em
`worker/src/email.ts`. Confirmado a funcionar em produção: código
recebido por email, usado para login com sucesso.

Se um dia for preciso repetir a configuração (ex: gerar um novo
refresh token, ou configurar isto noutra conta/projeto), o guia
completo fica em `NOTES_gmail_api_setup.md`.

Nota registada durante a configuração: da primeira vez que se gerou o
Refresh Token, a troca por Access Token falhava com `invalid_grant`.
Gerar um novo Refresh Token do zero (repetir só a parte do OAuth
Playground: Authorize APIs → Exchange authorization code for tokens)
resolveu — a causa exata não ficou 100% confirmada, mas o processo é
rápido de repetir se voltar a acontecer.

```bash
cd worker
wrangler secret put GMAIL_CLIENT_ID
wrangler secret put GMAIL_CLIENT_SECRET
wrangler secret put GMAIL_REFRESH_TOKEN
wrangler secret put GMAIL_SENDER_EMAIL
```

**Usa sempre `wrangler secret put`, nunca o dashboard Cloudflare** —
mesmo aviso do `ADMIN_PASSWORD`: secrets definidos pelo dashboard são
apagados no deploy seguinte feito pelo Workers Builds.

Depois de definidos os 4 secrets, testa: regista uma conta nova (ou
usa "Reenviar código" no admin numa conta com email por confirmar) e
confirma que o email chega à caixa de correio, em vez de aparecer
`devCode` na resposta.

### Manter o refresh token vivo (Cron Trigger)

O refresh token do Gmail é invalidado pela Google se não for usado
durante 6 meses seguidos. Login normal de qualquer concessionário já
"usa" o token (a troca por access token conta como uso, mesmo que o
email não chegue a ser enviado por outra razão), por isso isto só
seria um problema real se a plataforma ficasse sem nenhum login
durante meio ano inteiro -- pouco provável, mas fica coberto de
qualquer forma.

Um Cron Trigger (`[triggers]` em `worker/wrangler.toml`) corre no dia
1 de Janeiro, Maio e Setembro, às 4h UTC (de 4 em 4 meses, com
margem de sobra antes do limite de 6). Só troca o refresh token por
um access token novo -- não envia nenhum email, só "toca" no token
para a Google não o considerar inativo. Implementado no handler
`scheduled()` em `worker/src/index.ts`.

Isto é automático depois do deploy -- Cloudflare regista o Cron
Trigger sozinho a partir do que está em `wrangler.toml`, sem precisar
de nenhum passo manual extra. Para confirmar que está a correr, ver
Workers & Pages → `pecas-renault` → separador "Cron Triggers" no
dashboard Cloudflare (mostra o histórico de execuções passadas).

## Antes de divulgar a plataforma

- [ ] Publicar 15-20 referências próprias, para a plataforma não
      parecer vazia ao primeiro concessionário que entra.
- [ ] Rever o texto do email de apresentação, incluir o link direto
      para `conta.html`. Se houver password de registo definida
      (painel de admin → Configurações), incluir no email.
- [x] Ligar envio de email real — concluído e testado em produção.

## Nome da empresa no registo — nota prática

A lista oficial da Renault usa muitas vezes um nome comercial
abreviado, não a razão social completa — ex: "CARLOS ALBERTO - FAIAL"
em vez de "Carlos Alberto Gonçalves da Silva e Filho, Lda". O telefone
continua a validar corretamente mesmo que o concessionário escreva o
nome legal completo, mas para o matching por nome funcionar melhor
(caso de telefone não bater), convém escrever o nome tal como aparece
em https://www.renault.pt/concessionarios/lista-concessionarios.html.

## Painel de administrador

Ver README.md para a descrição pública. O caminho do ficheiro não
fica documentado em lado nenhum deste repositório, incluindo este
ficheiro — decisão deliberada, mantida mesmo aqui.

A autenticação é uma password única, sem sessões — cada ação no painel
envia a password num header HTTP customizado.
