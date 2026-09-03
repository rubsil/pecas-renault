# Stock Rede Renault

Marketplace interno para concessionários e agentes Renault/Dacia
publicarem stock de peças paradas, para que outros concessionários
possam encontrá-las por referência em vez de encomendar peça nova.

Sem scraping, sem dependência de terceiros frágeis: os únicos dados
externos usados são a lista pública de concessionários da Renault
(para validação de registos), importada uma vez.

## Estrutura

```
peca-troca/
├── worker/              Cloudflare Worker (API) + D1
│   ├── src/
│   │   ├── index.ts      rotas da API
│   │   ├── normalize.ts  normalização de texto/telefone/referência
│   │   ├── verification.ts  validação contra lista oficial
│   │   └── auth.ts       login por código (magic link)
│   ├── schema.sql        schema da base de dados
│   └── wrangler.toml     configuração de deploy
├── web/                  Frontend estático (GitHub Pages ou Cloudflare Pages)
│   ├── index.html         pesquisa de peças
│   ├── conta.html          registo / login / dashboard
│   └── publicar.html       publicar peça
├── data/
│   ├── dealers_page1.json  lista oficial de concessionários (30 de ~100+)
│   └── import_dealers.sql  SQL gerado, pronto a importar
└── scripts/
    └── import_dealers.py   gera o SQL de importação a partir do JSON
```

## Deploy — passo a passo

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

Já há 30 concessionários (página 1 de 4) em `data/dealers_page1.json`,
recolhidos de https://www.renault.pt/concessionarios/lista-concessionarios.html.

**Falta completar as páginas 2, 3 e 4** — o site carrega a lista via
JavaScript, por isso não dá para simplesmente fazer fetch da página;
é preciso abrir cada página num browser real (ou usar uma ferramenta
com JS rendering) e copiar os dados no mesmo formato de
`dealers_page1.json` para `dealers_page2.json`, `dealers_page3.json`,
`dealers_page4.json`.

Depois de teres todos os ficheiros em `data/`:

```bash
python3 scripts/import_dealers.py
wrangler d1 execute peca-troca-db --file=data/import_dealers.sql --remote
```

Isto é seguro correr mais do que uma vez com ficheiros diferentes —
cada INSERT é independente. Para evitar duplicados se corrqueres o
mesmo ficheiro duas vezes, podes limpar a tabela antes:
`wrangler d1 execute peca-troca-db --command="DELETE FROM official_dealers" --remote`

### 4. Deploy do Worker

```bash
cd worker
wrangler deploy
```

Isto dá-te um URL do género `https://peca-troca-api.<subdomínio>.workers.dev`.

### 5. Ligar o frontend ao Worker

Em cada ficheiro HTML (`web/index.html`, `web/conta.html`, `web/publicar.html`),
troca:

```js
const API_BASE = "https://peca-troca-api.workers.dev";
```

pelo URL real que o `wrangler deploy` te deu.

### 6. Publicar o frontend

A forma mais simples é GitHub Pages, tal como no nif-nome:

```bash
git init
git add .
git commit -m "Primeira versão"
git remote add origin <o-teu-repo>
git push -u origin main
```

Depois, nas definições do repositório GitHub → Pages → escolher a pasta `web/`.

## O que falta antes de mandares o email aos concessionários

- [x] Repositório no ar, GitHub Pages ligado (`docs/`), Worker deployado
      via Workers Builds (deploy automático a cada push)
- [x] Lista oficial completa (97 concessionários) importada para a D1
- [x] Validação automática por telefone + desempate por código postal
      (cadeias como Carby/Santogal)
- [x] Fluxo de registo → confirmação de email → login testado de ponta a ponta
- [x] Painel de administrador (`docs/admin.html`) — gestão de
      concessionários, peças e password de registo
- [ ] **Aplicar a migração `worker/migrations/0001_email_confirmation.sql`**
      na D1, se ainda não o fizeste (consola do dashboard Cloudflare —
      ver secção 2 acima).
- [ ] **Aplicar a migração `worker/migrations/0002_settings_table.sql`**
      na D1 — cria a tabela `settings` usada pela password de registo e
      pelo painel de administrador. Sem isto, o separador
      "Configurações" do painel não funciona.
- [ ] **Aplicar a migração `worker/migrations/0003_remove_reserved_status.sql`**
      na D1 — o estado `reserved` foi removido (nunca teve ação
      correspondente no dashboard do concessionário, só existia no
      painel de admin sem ninguém o usar). Esta migração só é
      necessária se por acaso já tiveres alguma peça marcada como
      `reserved`; caso contrário é inofensiva de qualquer forma.
- [ ] **Aplicar a migração `worker/migrations/0004_dealer_verified_at.sql`**
      na D1 — adiciona a coluna `verified_at`, usada pelo painel de
      admin para mostrar a data de verificação de cada concessionário.
      Sem isto, essa coluna aparece sempre vazia.
- [x] **Definir o secret `ADMIN_PASSWORD`** no Worker, para poderes
      entrar no painel de administrador (`docs/admin.html`). **Usa
      `wrangler secret put ADMIN_PASSWORD`** (a partir da pasta
      `worker/`), não o dashboard Cloudflare — ver aviso importante
      abaixo. Sem este secret definido, o painel de administrador
      fica sempre bloqueado, que é o comportamento seguro por omissão.

  > **Aviso — não uses o dashboard para secrets deste projeto.**
  > Definir o `ADMIN_PASSWORD` em Workers & Pages → Settings →
  > Variables and Secrets pareceu funcionar mas foi apagado
  > silenciosamente no deploy seguinte feito pelo Workers Builds
  > (bug conhecido da integração Git da Cloudflare — o CI limpa
  > secrets definidos manualmente a cada novo push). O sintoma foi
  > "password inválida" mesmo com o valor certo, sem erro nenhum
  > a apontar para a causa real.
  >
  > A forma correta e estável é sempre por linha de comandos:
  > ```
  > cd worker
  > wrangler secret put ADMIN_PASSWORD
  > ```
  > Isto grava o secret diretamente na versão publicada do Worker,
  > sem depender do processo de build do GitHub — sobrevive a
  > pushes seguintes sem se perder.

- [ ] Ligar o envio do código de confirmação a um serviço real de email
      (ver `NOTA DE IMPLEMENTAÇÃO` em `worker/src/index.ts`). Sem isto,
      o código aparece só na resposta da API (`devCode`) — bom para
      testar, não pronto para produção.
- [ ] Publicar 15-20 referências tuas próprias, para a plataforma não parecer
      vazia ao primeiro concessionário que entra.
- [ ] Rever o texto do email de apresentação e incluir o link direto para
      `conta.html`. Se definires uma password de registo (painel de
      admin → Configurações), inclui-a nesse email.

## Painel de administrador

Acessível em `docs/admin.html` (ex: `https://rubsil.github.io/pecas-renault/admin.html`).
Não está ligado em nenhum sítio visível do site — é uma página "escondida",
só quem souber o URL (e a password) consegue entrar.

- **Estatísticas** (topo da página): total de concessionários,
  verificados, pendentes, peças ativas, publicadas nos últimos 7 dias.
- **Concessionários**: editar nome/telefone/email/cidade, marcar como
  verificado manualmente, eliminar conta (e as suas peças), ver data
  de registo e de verificação, reenviar código de confirmação de
  email a quem ficou preso nesse passo, criar conta manualmente
  já verificada e com email confirmado (sem código nenhum, com
  autofill do nome a partir da lista oficial) — para quem pediu para
  ser registado diretamente, sem passar pelo fluxo normal.
- **Cobertura**: os 97 concessionários da Renault, cruzados com o
  estado de registo na plataforma — quem já está registado (e se está
  verificado) e quem ainda não apareceu. Filtro rápido para veres só
  quem falta registar, útil para saberes a quem vale a pena voltar a
  lembrar sobre a plataforma.
- **Peças**: editar referência/descrição/quantidade/estado, eliminar
  qualquer peça de qualquer concessionário, filtrar por concessionário,
  ver data de publicação/última atualização.
- **Configurações**: definir ou remover a password de registo. Se
  definida, o registo passa a exigir esse código; se vazia, qualquer
  concessionário da lista oficial pode registar-se livremente.

A autenticação é uma password única (`ADMIN_PASSWORD`, ver acima),
sem sessões — cada ação no painel envia a password num header. É
simples de propósito: só uma pessoa usa isto, sempre por HTTPS, com
volume de uso baixo.

## Correções manuais (email mal escrito, etc.)

Como o volume de concessionários é pequeno, correções pontuais também
podem ser feitas diretamente na consola D1 do dashboard Cloudflare
(alternativa ao painel de administrador acima). Exemplo, para corrigir
um email:

```sql
UPDATE dealers SET email = 'email-correto@exemplo.pt', email_confirmed = 0 WHERE phone_normalized = '292240200';
```

Colocar `email_confirmed = 0` obriga a nova confirmação, para garantir
que o email corrigido é mesmo válido antes de voltar a servir para login.

## Notas de design

- Cada concessionário regista-se com nome da empresa + telefone + código
  postal. O sistema cruza automaticamente contra a lista oficial da
  Renault: telefone exato = validação automática imediata. Algumas
  cadeias (Carby, Santogal) usam a mesma central telefónica para várias
  lojas — nesses casos o código postal desempata qual loja exata; sem
  ele, fica pendente para confirmação manual em vez de adivinhar
  (ver `worker/src/verification.ts`).
- **Nome da empresa no registo**: a lista oficial da Renault usa muitas
  vezes um nome comercial abreviado, não a razão social completa — ex:
  "CARLOS ALBERTO - FAIAL" em vez de "Carlos Alberto Gonçalves da Silva
  e Filho, Lda". O telefone continua a validar corretamente mesmo que o
  concessionário escreva o nome legal completo, mas para o matching por
  nome funcionar melhor (caso de telefone não bater), convém escrever o
  nome tal como aparece em
  https://www.renault.pt/concessionarios/lista-concessionarios.html.
- Login sem password: pede-se um código de 6 dígitos, trocado por um
  token de sessão de 30 dias.
- **Telefone vs. email**: o telefone é a identidade forte (validado
  contra a lista oficial da Renault) e nunca muda depois do registo.
  O email é obrigatório desde o início — serve para login e como
  contacto por escrito entre concessionários — mas só fica ativo
  depois de confirmado uma vez, logo a seguir ao registo (evita que
  um erro de digitação no email deixe alguém sem conseguir entrar
  antes sequer de a conta funcionar). Se o email ficar mal escrito,
  a correção é manual, diretamente na D1 — dado o volume pequeno de
  concessionários, não vale a pena um fluxo de recuperação automático
  para isto (ver `worker/migrations/0001_email_confirmation.sql`).
- A pesquisa de peças é pública (não exige login) — só publicar exige conta.
  Isto reduz fricção para quem só quer verificar se algo existe antes de
  decidir registar-se.
