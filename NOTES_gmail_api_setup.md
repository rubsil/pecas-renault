# Guia: Configurar envio de email via Gmail API (grátis, sem domínio)

Este guia prepara uma conta Gmail dedicada para enviar os códigos de
confirmação de email da plataforma, sem precisar de domínio próprio
nem de nenhum serviço terceiro pago. Usa diretamente a API oficial da
Google (Gmail API), gratuita, com quota muito acima do que vamos
precisar (97 concessionários, uso ocasional).

Depois de configurado, fica totalmente automático — não precisas de
repetir nada disto, mesmo daqui a anos.

## Antes de começar

Precisas de:
- Um browser (telemóvel ou PC, tanto faz)
- Uns 20-30 minutos, sem pressa
- Vontade de criar uma conta Gmail nova (recomendado, para não misturar
  com a tua conta pessoal)

---

## Passo 1 — Criar a conta Gmail dedicada

Se ainda não tiveres uma conta só para isto:

1. Vai a `accounts.google.com/signup`
2. Cria uma conta com um nome tipo `stockrederenault@gmail.com` (ou
   parecido — este vai ser o email que aparece como remetente dos
   códigos de confirmação)
3. Guarda a password num sítio seguro (gestor de passwords)

## Passo 2 — Criar o projeto na Google Cloud Console

1. Vai a `console.cloud.google.com` e entra **com a conta Gmail nova**
   que acabaste de criar (importante: usa essa conta, não a tua pessoal)
2. Se for a primeira vez, aceita os termos de serviço
3. No topo da página, clica no seletor de projeto (ao lado do logo
   "Google Cloud") → **"New Project"**
4. Nome do projeto: `Stock Rede Renault` (ou parecido)
5. Clica em **Create**
6. Espera uns segundos até o projeto ficar pronto, depois seleciona-o
   (deve aparecer uma notificação, ou seleciona no mesmo seletor de
   projeto do passo 3)

## Passo 3 — Ativar a Gmail API

1. No menu lateral esquerdo (ícone ☰), vai a **APIs & Services** →
   **Library**
2. Na caixa de pesquisa, escreve `Gmail API`
3. Clica no resultado **Gmail API**
4. Clica em **Enable**

## Passo 4 — Configurar o consentimento OAuth (Google Auth Platform)

**Nota:** a Google reorganizou esta parte da interface recentemente.
Já não se chama "OAuth consent screen" numa página só — chama-se
agora **Google Auth Platform**, dividido em separadores (Branding,
Audience, Clients). Os passos abaixo já refletem essa interface nova.

1. No menu lateral, vai a **APIs & Services** → **Google Auth
   Platform** (se aparecer "Get Started", clica nisso)
2. Se pedir para escolher "User Type" (separador **Audience**),
   escolhe **External** (mesmo sendo só para ti, é a opção correta
   neste caso — "Internal" só existe para contas Google Workspace
   de empresa)
3. No separador **Branding**, preenche:
   - **App name**: `Stock Rede Renault`
   - **User support email**: a tua conta Gmail nova
4. No separador **Data Access** (ou "Scopes", pode aparecer com
   qualquer um dos dois nomes), clica em **Add or Remove Scopes**,
   procura por `gmail.send` e marca o scope
   `.../auth/gmail.send` (é o único que vamos precisar — só permite
   enviar email, nada mais). Guarda.
5. No separador **Audience**, na secção **Test users**, clica em
   **Add Users** e adiciona o **email da própria conta Gmail nova**
   (a mesma que estás a usar para tudo isto). Isto é importante —
   sem isto, nem tu próprio consegues autorizar a aplicação.
6. No separador **Contact Information** (se aparecer em separado),
   confirma o email de contacto (a mesma conta Gmail)

## Passo 5 — Criar as credenciais OAuth (Client ID e Client Secret)

1. No menu lateral, vai a **APIs & Services** → **Credentials**
2. Clica em **+ Create Credentials** → **OAuth client ID**
3. **Application type**: escolhe **Web application**
4. **Name**: `Worker Stock Rede Renault`
5. Em **Authorized redirect URIs**, clica **+ Add URI** e cola
   exatamente isto:
   ```
   https://developers.google.com/oauthplayground
   ```
   (Vamos usar esta ferramenta oficial da Google só para gerar o
   primeiro código de autorização — depois disso, nunca mais
   precisamos dela.)
6. Clica em **Create**
7. Vai aparecer uma janela com **Client ID** e **Client Secret** —
   **copia os dois para um sítio seguro** (vamos precisar deles já a
   seguir, e também no Worker mais tarde)

## Passo 6 — Mudar para "In production" (evita expirar ao fim de 7 dias)

**Nota:** este botão já não está numa página separada chamada
"Publishing status" — fica dentro do separador **Audience**, o
mesmo onde adicionaste os Test Users no Passo 4.

1. Volta a **APIs & Services** → **Google Auth Platform** →
   separador **Audience**
2. Deve aparecer o estado atual da app perto do topo (algo como
   "Testing")
3. Procura o botão **Publish App** nessa mesma página (pode estar
   perto do estado atual, ou no fim da página — em telemóvel às
   vezes é preciso deslizar para o ver)
4. Clica em **Publish App**. Confirma. Não é preciso verificação da
   Google para o teu caso (é uso pessoal, menos de 100 utilizadores,
   scope não-restrito) — só aparece um aviso a dizer isso, aceitas e
   avança

Se não encontrares o botão "Publish App" em lado nenhum do separador
Audience, tira print e mostra-me — a Google muda estes ecrãs com
frequência e pode ter reorganizado outra vez.

## Passo 7 — Gerar o Refresh Token (usando o OAuth Playground da Google)

Este é o passo que troca a tua autorização por um código que o Worker
vai poder usar para sempre.

1. Vai a `developers.google.com/oauthplayground`
2. No canto superior direito, clica no ícone de engrenagem (⚙️)
3. Marca a opção **"Use your own OAuth credentials"**
4. Cola o **Client ID** e **Client Secret** que guardaste no Passo 5
5. Fecha essa caixa de definições
6. Do lado esquerdo, na caixa de pesquisa "Select & authorize APIs",
   escreve `Gmail API v1` e escolhe o scope:
   ```
   https://www.googleapis.com/auth/gmail.send
   ```
   (Este é o scope mais restrito que ainda permite enviar email —
   só dá permissão para enviar, nunca para ler, apagar ou modificar
   nada na caixa de correio. É a opção mais segura e suficiente
   para o que precisamos.)
7. Clica em **Authorize APIs**
8. Vai pedir para entrares com uma conta Google — usa a **conta Gmail
   nova**
9. Vai aparecer um aviso "Google hasn't verified this app" — isto é
   esperado (o teu próprio projeto, sem verificação, como já vimos
   que é normal para uso pessoal). Clica em **Advanced** → **Go to
   Stock Rede Renault (unsafe)** — é seguro, é a tua própria aplicação
10. Confirma as permissões pedidas
11. Vais voltar ao OAuth Playground, agora com um **Authorization
    code** preenchido automaticamente
12. Clica em **Exchange authorization code for tokens**
13. Vai aparecer um **Refresh token** e um **Access token** — **copia
    o Refresh Token para um sítio seguro**. É este valor que vamos
    guardar no Worker (como secret, tal como já fizemos com o
    `ADMIN_PASSWORD`)

## O que vais ter no final

No final deste guia, deves ter guardados em sítio seguro:

- **Client ID** (Passo 5)
- **Client Secret** (Passo 5)
- **Refresh Token** (Passo 7)
- O email da conta Gmail nova (Passo 1)

Estes 4 valores são tudo o que o Worker precisa para enviar emails
para sempre, sem mais nenhuma intervenção manual.

## Próximo passo (faço eu, depois de teres isto)

Quando tiveres estes 4 valores, volta aqui e eu:

1. Implemento o código no Worker que usa o Refresh Token para gerar
   Access Tokens automaticamente sempre que for preciso enviar um
   email (o Access Token normal expira ao fim de 1 hora, mas o
   Refresh Token gera novos sozinho, sem limite)
2. Implemento a chamada à Gmail API para enviar o código de
   confirmação por email a sério, substituindo o `devCode` que
   aparece hoje na página
3. Guardamos os 4 valores como secrets no Worker (`wrangler secret
   put`, tal como já fizemos com o `ADMIN_PASSWORD` — nunca ficam
   visíveis no código público do GitHub)

Não tens de perceber os detalhes técnicos disso — só precisas de
guardar bem os 4 valores acima e voltar aqui.
