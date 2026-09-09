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
- `0008_listing_photos.sql` — tabela `listing_photos` (fotos via ImgBB)
- `0009_demo_account.sql` — coluna `is_demo` + conta de demonstração fixa (id 999999)
- `0010_dealer_preferences.sql` — colunas `pref_photo_thumbnails`, `pref_compact_list`
- `0011_more_dealer_preferences.sql` — colunas `pref_sort_order`, `pref_default_view`
- `0012_alert_email_notifications.sql` — coluna `pref_alert_notifications` + tabela `alert_notifications_sent`
- `0013_login_rate_limit.sql` — colunas `login_code_requests_count`, `login_code_window_started_at`
- `0014_optional_password_login.sql` — colunas `password_hash`, `password_salt`

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

## Password de registo — toggle no admin

No separador Configurações, um checkbox liga/desliga a exigência de
código de acesso no registo, em vez de só um campo de texto solto.
Desligado, o bloco fica visualmente cinzento e bloqueado
(`pointer-events: none`); ao clicar "Guardar" nesse estado, grava
sempre valor vazio (registo aberto), mesmo que ainda haja texto
esquecido no campo -- evita perder a password por engano só de
mexer no toggle sem confirmar a intenção com o botão Guardar.

Nova rota pública `GET /api/settings/registration-status` (sem
autenticação de admin) diz só sim/não se há password definida, nunca
revela o valor -- usada em `conta.html` para esconder por completo o
campo "Código de acesso" no registo quando não for preciso, em vez de
mostrar um campo confuso a quem não precisa dele. Se a rota falhar por
qualquer razão, assume-se `passwordRequired: true` por segurança (o
campo continua visível, nunca esconde por engano numa situação em que
seria mesmo necessário).

## Fotos das peças (ImgBB)

O upload de fotos ao publicar/editar uma peça é feito **diretamente do
browser para a API do ImgBB** (`api.imgbb.com/1/upload`) -- a imagem
nunca passa pelo nosso Worker, evita limites de tamanho de pedido e
poupa a nossa largura de banda. O Worker só guarda o link que o ImgBB
devolve (`worker/migrations/0008_listing_photos.sql`).

**A API key do ImgBB está visível no código do frontend** (`docs/publicar.html`
e `docs/conta.html`, variável `IMGBB_API_KEY`) -- isto é intencional,
não um esquecimento. Como o upload acontece diretamente do browser da
pessoa, a chave tem de estar acessível ali; não há como escondê-la
sem fazer o upload passar pelo Worker (o que perderíamos a vantagem
de não sobrecarregar o Worker com uploads de imagens). A chave do
ImgBB só permite fazer uploads, não dá acesso a nada sensível nem
à conta em si -- risco aceitável para este caso.

Limite de 6 fotos por peça, controlado no backend (`POST
/api/listings/:id/photos` recusa a 7ª).

Painel de admin também mostra as fotos de qualquer peça (separador
Peças, coluna "Fotos") e permite eliminar qualquer uma, sem restrição
de dono -- útil para moderação (ex: foto errada, desfocada, ou de
outra peça por engano).

**Eliminar uma foto no dashboard não a apaga do ImgBB.** A `delete_url`
que o ImgBB devolve no upload é uma página feita para um humano abrir
e confirmar num clique -- não é um endpoint de API real (o domínio da
delete_url, tipicamente `ibb.co`, não aceita chamadas cross-origin do
nosso site; e mesmo que aceitasse, é pensada para navegação humana,
não para ser chamada por código). Testámos abrir a delete_url numa
nova aba automaticamente, mas foi revertido por ficar uma experiência
estranha para quem usa o site -- decisão consciente: "eliminar" só
remove a referência da nossa base de dados, a imagem em si fica órfã
no ImgBB (sem custo nem exposição associados, já que deixa de estar
ligada a qualquer peça publicada).

Se um dia for preciso limpar essas imagens órfãs a sério (ex: por
limite de armazenamento, que hoje não existe no plano gratuito), a
delete_url continua guardada em `listing_photos.delete_url` -- dá para
implementar isso manualmente mais tarde se necessário, mas não é
prioridade agora.

A pré-visualização usa sempre `thumb_url` (miniatura mais pequena,
carrega mais rápido), e só mostra a imagem em tamanho completo
(`url`) quando se clica -- importante para fotos grandes não
tornarem a página lenta a carregar.

## Dashboard do concessionário ("A minha conta")

Ganhou dois blocos que faltavam desde o início:

- **Ficha de contacto**: telefone, email, cidade, morada -- já vinham
  de `/api/dealers/me`, simplesmente nunca eram mostrados. O
  concessionário não pode editar estes dados diretamente (nota no
  próprio ecrã a dizer para contactar o admin) -- decisão consciente,
  não construída edição própria para não expandir o pedido original;
  possível funcionalidade futura se fizer sentido.

- **Alertas de referência**: a criação (`POST /api/alerts`) e listagem
  (`GET /api/alerts/mine`) já existiam desde muito cedo no backend,
  mas nunca tiveram interface -- ficou uma funcionalidade "invisível"
  bastante tempo. Agora o dashboard tem um campo para criar e uma
  lista com botão de cancelar. Nova rota `DELETE /api/alerts/:id`
  (verifica dono, ao contrário da versão admin que não tem essa
  restrição). POST /api/alerts também passou a verificar duplicados
  (evita a mesma referência ser subscrita duas vezes pelo mesmo
  concessionário).

## Conta de demonstração

Para apresentações a quem ainda não tem conta real (ex: Renault
Portugal) sem passar pelo fluxo normal de confirmação por email.

**Sem link nem botão visível no site** -- de propósito, tipo "easter
egg". Entra-se escrevendo as credenciais fixas exatas nos campos
normais de telefone/email do login (`conta.html`) e clicando em
"Pedir código" como habitualmente; o handler deteta que os valores
batem certo com as credenciais demo e chama a rota dedicada em vez do
fluxo normal de código -- quem não souber os dados exatos nunca
percebe que esta funcionalidade existe.

**Credenciais fixas**: telefone `demo`, email `modo@demo` (case-
insensitive). Reconhecidas por uma rota dedicada
(`POST /api/auth/demo-login`), que nunca gera nem exige código --
completamente à parte do fluxo normal de login.

**A conta em si**: um único registo fixo em `dealers`, id `999999`
(migração 0009), marcado com `is_demo = 1`.

**Reset ao estado inicial**: acontece em dois momentos --
1. Ao clicar "Sair" -- `POST /api/auth/logout` verifica `is_demo` e
   chama `resetDemoAccount()` antes de confirmar o logout.
2. Rede de segurança: Cron Trigger de 6 em 6 horas (`0 */6 * * *` em
   `wrangler.toml`), para quem fecha o browser sem clicar em "Sair".

`resetDemoAccount()` (em `worker/src/index.ts`) apaga tudo o que a
conta demo tenha criado (peças, fotos das peças, referências
alternativas, alertas) e restaura os campos fixos da própria conta
(nome, telefone, email, cidade -- limpa morada/coordenadas). Nunca
elimina a conta em si, só o que ela produziu.

**Invisibilidade total**: as três rotas públicas que devolvem
concessionários/peças (`browse`, `search`, `map`) filtram
`WHERE d.is_demo = 0` -- a conta demo nunca aparece na pesquisa nem
no mapa, mesmo que tenha peças publicadas no momento. As estatísticas
do admin (`/api/admin/stats`) também excluem a demo das contagens de
concessionários, para não inflacionar os números. As rotas do
**admin** (listar contas, peças, alertas, exportar CSV) continuam
**sem filtro**, de propósito -- o admin precisa de ver e poder gerir
a conta demo normalmente.

**Banner de aviso**: função `showDemoBanner()`, duplicada em
`index.html`, `conta.html` e `publicar.html` (o projeto não tem um
ficheiro CSS/JS partilhado entre páginas). Insere um banner fixo no
topo assim que `/api/dealers/me` devolve `is_demo: true`. Se um dia
for preciso alterar o texto ou estilo, tem de ser feito nos 3
ficheiros.

**Gestão pelo admin**: a conta demo aparece no separador "Contas",
sempre no topo da lista (`ORDER BY is_demo DESC`), com badge laranja
"DEMO" e um lembrete visível das credenciais fixas (telefone `demo`,
email `modo@demo`) -- para nunca teres de ir à documentação ou à base
de dados para recordar como entrar. Editável como qualquer conta
normal (nome, telefone, email, cidade, verificação), mas com duas
diferenças:
- O botão "Eliminar" é substituído por "Repor demo" -- chama
  `POST /api/admin/demo-account/reset`, o mesmo `resetDemoAccount()`
  usado no logout e no Cron Trigger, para forçar uma reposição
  imediata sem esperar pelo próximo logout ou pela rede de segurança
  de 6 em 6 horas.
- `DELETE /api/admin/dealers/:id` recusa explicitamente `id = 999999`
  -- a conta demo nunca pode ser eliminada de facto, só reposta,
  porque o login demo e o Cron Trigger dependem deste ID fixo existir
  sempre.

O botão "Reenviar código" nunca aparece para esta conta (já tem
`email_confirmed = 1` fixo desde a migração), por isso não há risco
de tentar enviar um código real para o endereço fictício `modo@demo`.

**Telefone e email são fixos, mesmo pelo admin.** O login demo
(`POST /api/auth/demo-login`) compara sempre contra as strings fixas
`"demo"` / `"modo@demo"` escritas no código -- nunca consulta a base
de dados. Editar esses dois campos pelo admin não mudaria o login
(continuaria a exigir os valores fixos), e o próximo reset (logout ou
Cron de 6h) reporia os valores originais de qualquer forma -- ficaria
confuso sem trazer benefício real. Por isso, `PATCH /api/admin/dealers/:id`
recusa explicitamente alterações a `phone`/`email` quando o `id` é o
da conta demo (outros campos, como `city`, continuam editáveis
normalmente). No frontend, os campos aparecem desativados
(`disabled`) só nesta linha da tabela, com tooltip a explicar porquê.

Se um dia for preciso mudar as credenciais fixas de demonstração
(ex: por segurança, ou para algo mais memorável), isso é feito
diretamente no código (`worker/src/index.ts`, rota `demo-login`), não
pelo painel de admin.

## Preferências de visualização, sincronizadas entre dispositivos

"Mostrar miniaturas de fotos" e "Lista compacta" (index.html) deixaram
de viver só no localStorage do browser -- para quem tem sessão, ficam
gravadas na conta (`dealers.pref_photo_thumbnails`,
`dealers.pref_compact_list`, migração 0010) e sincronizam nos dois
sentidos:

- Mudar o toggle na pesquisa (`index.html`) grava no backend
  (`PATCH /api/dealers/me/preferences`) e no localStorage.
- Mudar na nova aba "Preferências" do dashboard (`conta.html`) faz o
  mesmo, ao contrário.
- Ao entrar em `index.html`/`publicar.html` com sessão, os valores do
  backend (vindos de `GET /api/dealers/me`, que já devolve os dois
  campos) têm sempre prioridade sobre o que estiver no localStorage --
  garante que a mesma pessoa vê a mesma preferência em qualquer
  dispositivo onde entrar, mesmo que o localStorage local esteja
  desatualizado ou seja de outro browser.

Quem pesquisa **sem sessão** continua a usar só o localStorage, como
antes desta funcionalidade -- não há conta onde gravar.

Falhas ao gravar no backend (rede, sessão expirada) são silenciosas
no toggle da pesquisa (a preferência continua válida localmente); na
aba Preferências mostram uma mensagem de erro, já que aí é a ação
principal do ecrã.

A conta de demonstração restaura estas duas colunas para os valores
por defeito (`pref_photo_thumbnails = 1`, `pref_compact_list = 0`) no
reset, tal como o resto dos seus dados.

**Bug corrigido**: a máscara de telefone (`attachPhoneMask()` em
`conta.html`) removia todos os caracteres não numéricos a cada tecla
-- isto impedia escrever "demo" no campo de telefone do login,
bloqueando o acesso à conta de demonstração (que usa essa palavra
como "telefone", ver rota `/api/auth/demo-login`). Corrigido: se o
texto tiver alguma letra, a máscara não intervém, deixa passar sem
formatação.

**Bug corrigido**: o layout das checkboxes de preferência
(`.pref-toggle-row`) ficava esticado de forma estranha -- o
`<span>` exterior ao texto não tinha `flex: 1`, o browser distribuía
o espaço de forma imprevisível entre o checkbox nativo e o texto.
Corrigido com uma classe explícita (`.pref-toggle-text`) e
`flex: 0 0 auto` fixo no checkbox.

### Mais duas preferências (migração 0011)

- **Ordenação por defeito** (`pref_sort_order`, `'recent'` ou
  `'distance'`): controla se `index.html` envia `fromDealerId` no
  pedido de listagem (o que já ativava a ordenação por distância no
  backend, lógica pré-existente) -- com `'recent'`, não envia, mesmo
  havendo `myDealerId` disponível, para a pessoa poder mesmo escolher
  ver por data. Só tem efeito prático com sessão e coordenadas
  gravadas; sem isso, é sempre por data, como já era antes.
- **Vista inicial** (`pref_default_view`, `'list'` ou `'map'`): se
  for `'map'`, `index.html` simula automaticamente o clique no botão
  de mapa ao carregar (reaproveita toda a lógica já existente de
  inicializar o Leaflet, em vez de duplicar código).

Ao contrário das duas primeiras preferências, estas não têm
equivalente no localStorage -- só fazem sentido com sessão (a
ordenação por distância precisa de coordenadas da conta; a vista
inicial não tinha nenhum estado persistido localmente antes desta
funcionalidade). Editáveis só na aba Preferências do dashboard,
via dois `<select>` (não checkboxes, por terem mais de duas opções
nomeadas).

## Notificação de alertas por email (migração 0012)

Quando alguém publica uma peça, `notifyMatchingAlerts()` (chamada
depois de a peça e as suas referências alternativas já estarem
gravadas) verifica se a referência principal ou alguma das
substituições correspondem a um alerta ativo de outro concessionário,
e envia email via Gmail API (mesmo mecanismo já usado para os
códigos de login).

**Notifica de novo se aparecer peça diferente.** Decisão consciente:
se a primeira peça correspondente a um alerta for vendida antes de o
concessionário reagir, ele quer saber da segunda também. A proteção
contra duplicados é ao nível do **par** alerta+peça, não do alerta
sozinho -- tabela `alert_notifications_sent` com `UNIQUE(alert_id,
listing_id)`, que bloqueia ao nível da própria base de dados mesmo
que a lógica da aplicação falhe de alguma forma. Testado
isoladamente com SQLite: primeira inserção para um par passa,
segunda para o mesmo par falha (IntegrityError), inserção para o
mesmo alerta mas peça diferente volta a passar.

**Preferência `pref_alert_notifications`, ligada por defeito.**
Editável na aba Preferências do dashboard. Quem desliga continua a
ver os alertas satisfeitos no próprio dashboard (badge, link "Ver
peça"), só deixa de receber o email.

Falhas de envio (Gmail não configurado, erro de rede, etc.) nunca
bloqueiam a publicação da peça em si -- a função é chamada depois de
a peça já estar gravada na base de dados, e qualquer erro fica só
nos logs do Worker.

## Editar o próprio telefone

`PATCH /api/dealers/me/phone` (rota separada de preferências, de
propósito -- telefone é dado de contacto real, não preferência de
visualização). Valida 9 dígitos depois de normalizar. Editável
diretamente na ficha de contacto do dashboard (campo + botão
"Guardar"), com aviso de que esse número passa a servir para login
a partir daí. Email não é editável -- já é escolhido livremente no
registo, ao contrário do telefone (pré-preenchido pela lista
oficial), por isso não há o mesmo caso de precisar de corrigir depois.

## Rate limiting no pedido de código de login (migração 0013)

Máximo 5 pedidos de código por hora, por conta -- evita gastar a
quota diária do Gmail sem necessidade real (ex: alguém a testar
repetidamente, ou abuso). Janela deslizante: `login_code_window_started_at`
guarda quando a janela atual começou, `login_code_requests_count`
conta os pedidos dentro dela; ao passar 1 hora desde o início da
janela, reinicia sozinha no próximo pedido. Testada isoladamente com
4 cenários (primeiro pedido, janela expirada, dentro do limite,
excede o limite). Não afeta o login demo, que usa uma rota
completamente separada (`/api/auth/demo-login`).

## Peças vendidas, checkbox explícita + secção própria

Antes, marcar uma peça como vendida só acontecia implicitamente ao
zerar a quantidade (botão "−" repetidamente) -- sem nenhum aviso de
que isso ia acontecer, fácil de fazer sem querer e sem forma de
reverter pela interface (o botão "+" fica desativado quando
`status = sold`).

Agora, no dashboard: checkbox "Vendida" explícita ao lado do
contador de quantidade. Marcar chama `PATCH /api/listings/:id` com
`{status: "sold"}` (não mexe na quantidade -- fica como estava,
guardando "quantas tinha quando vendi" como histórico).
**Desmarcar** chama o mesmo endpoint com `{status: "active", quantity: 1}`
-- reativa com quantidade 1 (não fazia sentido "active" com
quantidade 0); se tinha mais unidades antes, ajusta-se com os
botões +/- a seguir.

Peças vendidas aparecem numa **secção própria**, separada
visualmente das disponíveis (título "Vendidas (N)", linhas com
opacidade reduzida) -- antes ficavam misturadas na mesma lista, só
distinguidas por um texto pequeno "vendida" a meio da linha.

`renderMyListings()` foi dividida: a função extraiu a construção de
cada linha para `renderListingRow()` (chamada uma vez por peça, para
cada secção), mantendo a delegação de eventos (tags, ações, guardar/
cancelar edição) ligada ao container principal que engloba as duas
secções -- sem isto, os listeners não apanhavam as linhas
renderizadas dentro de sub-containers.

## Pesquisa por descrição, não só por referência

`GET /api/listings/search` passa a procurar também em
`parts_listings.description`, além da referência (principal e
alternativas). A referência usa sempre `normalizeReference()`
(maiúsculas, sem espaços/hífens -- correto para códigos de peça),
mas a descrição usa o texto tal como escrito, só em minúsculas --
usar `normalizeReference()` aqui removeria os espaços entre palavras
("kit embraiagem" viraria "KITEMBRAIAGEM"), o que nunca bateria
certo com nada. Testado isoladamente: pesquisa por referência,
por descrição (com e sem maiúsculas), sem correspondência, e
especificamente o cenário de duas palavras com espaço.

Placeholder do campo de pesquisa atualizado em `index.html` (hero e
barra fixa) para refletir que aceita também descrição.

## Segurança: email já não é exposto na API a quem não tem sessão

Revisão de segurança confirmou uma fragilidade real: as 3 rotas
públicas de pesquisa (`browse`, `search`, `map`) enviavam sempre o
email do concessionário na resposta JSON, mesmo sem sessão -- a
decisão de "só mostrar a quem está autenticado" era só do frontend
(escondia visualmente), não do backend. Quem inspecionasse a resposta
de rede diretamente (ferramentas de developer do browser) via sempre
o email, sessão ou não.

Corrigido com `optionalDealerId()` (como `requireDealer()`, mas nunca
bloqueia o pedido -- devolve o id do concessionário se houver sessão
válida, ou `null` caso contrário). As 3 rotas passam a construir a
query dinamicamente: `d.email` só entra no `SELECT` quando há sessão
confirmada pelo backend; sem isso, o campo vem sempre `NULL`. O
frontend não precisou de nenhuma alteração -- já verificava
`r.email` antes de mostrar o link, por isso passa a funcionar
corretamente sem mudança de código aí.

Testada isoladamente a lógica de resolução de sessão opcional (token
válido, expirado, ausente, inexistente) e a construção dinâmica da
query nos dois casos.

## Login opcional por password (migração 0014)

Por defeito, entrar continua a exigir sempre código por email, exatamente
como sempre foi -- login por password é sempre uma escolha da própria
pessoa, nunca obrigatório.

**Guardar a password, com segurança de verdade.** `worker/src/password.ts`
usa PBKDF2-SHA256 (Web Crypto API nativo do Workers, sem dependências
externas), 100.000 iterações (limite prático do `crypto.subtle` no
Cloudflare Workers -- valores mais altos são bloqueados pela própria
plataforma), salt aleatório único gerado de novo sempre que a password
é definida ou trocada. Nunca se guarda a password em texto simples --
só o hash e o salt. Testado isoladamente: password certa aceite,
errada rejeitada, mesma password gera hashes diferentes em contas
diferentes (salts diferentes).

**O admin nunca vê passwords, só as pode limpar.** Decisão de segurança
deliberada -- guardar de forma reversível (para o admin "ver") seria
guardar em texto simples, e qualquer falha de segurança exporia as
passwords de toda a gente de uma vez. `POST /api/admin/dealers/:id/reset-password`
só apaga `password_hash`/`password_salt`, forçando a conta a voltar a
usar código por email; a pessoa define uma password nova se quiser,
a partir daí. Botão "Repor password" no admin só aparece em contas
que já têm uma definida (`has_password`, devolvido por `GET
/api/admin/dealers`).

**Fluxo de login.** `index.html`/`conta.html`: ao escrever telefone +
email, `GET /api/auth/check-password-status` (pública, mas nunca
confirma se a conta existe -- só diz `hasPassword: true/false`)
consulta com um debounce de 400ms se essa conta tem password. Se
tiver, mostra o campo de password + botão "Entrar" (chama `POST
/api/auth/login-password`, com mensagem de erro genérica que não
distingue "conta não existe" de "password errada", para não ajudar
enumeração de contas); com link "Esqueci a password, entrar por
código de email" que volta ao fluxo normal. Se não tiver, mantém-se o
fluxo já existente.

**Proposta pós-login.** Depois de um login bem-sucedido por código
(não por password, nem no login demo -- marcado com
`sessionStorage.setItem("logged_in_via_code")`), se a conta ainda não
tiver password, mostra um modal a propor definir uma, com botão
"Ignorar e usar código na próxima". Só aparece uma vez por sessão de
browser (a flag é removida assim que o modal é mostrado), mesmo que
`loadDashboard()` corra várias vezes.

**Gestão contínua.** Aba "Dados da conta" no dashboard, secção
própria (`dash-password-card`) com dois estados: sem password
(formulário para definir) e com password (mudar ou remover, com
confirmação antes de remover).

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
