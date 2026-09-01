# Peça-Troca

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

- [ ] Completar a lista oficial com as páginas 2-4 (ver passo 3 acima)
- [ ] Ligar o envio de código de login a um serviço real de SMS ou email
      (ver `NOTA DE IMPLEMENTAÇÃO` em `worker/src/index.ts`, rota `/api/auth/request-code`).
      Sem isto, o código aparece só na resposta da API (`devCode`) — bom para testar,
      não pronto para produção.
- [ ] Publicar 15-20 referências tuas próprias, para a plataforma não parecer vazia
      ao primeiro concessionário que entra.
- [ ] Rever o texto do email de apresentação (mencionado nas conversas anteriores)
      e incluir o link direto para `conta.html`.

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
- Login sem password: pede-se um código de 6 dígitos por telefone/email,
  válido 15 minutos, trocado por um token de sessão de 30 dias.
- A pesquisa de peças é pública (não exige login) — só publicar exige conta.
  Isto reduz fricção para quem só quer verificar se algo existe antes de
  decidir registar-se.
