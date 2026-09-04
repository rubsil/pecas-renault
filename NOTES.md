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

## Ligar envio de email real (por fazer)

O código de confirmação ainda aparece só na resposta da API
(`devCode`, ver `NOTA DE IMPLEMENTAÇÃO` em `worker/src/index.ts`) —
bom para testar, não pronto para produção com concessionários reais.
Falta ligar a um serviço tipo Resend.

## Antes de divulgar a plataforma

- [ ] Publicar 15-20 referências próprias, para a plataforma não
      parecer vazia ao primeiro concessionário que entra.
- [ ] Rever o texto do email de apresentação, incluir o link direto
      para `conta.html`. Se houver password de registo definida
      (painel de admin → Configurações), incluir no email.
- [ ] Ligar envio de email real (ver acima).

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
