# Stock Rede Renault

Marketplace interno para concessionários e agentes Renault/Dacia
publicarem stock de peças paradas, para que outros concessionários
possam encontrá-las por referência em vez de encomendar peça nova.

Nasceu de um problema concreto: peças sem rotatividade local que
ficam paradas em armazém, quando podiam ser exatamente o que outro
concessionário está à procura noutro ponto da rede.

## Como funciona

Cada concessionário regista-se com o nome da empresa e o telefone.
O sistema confirma automaticamente a identidade cruzando esses dados
contra a lista pública de concessionários oficiais da Renault — sem
necessidade de aprovação manual na maioria dos casos.

Depois de registado e verificado, pode publicar peças que tem em
stock parado (referência, descrição, quantidade, notas), incluindo
referências de substituição — uma peça pode ter vários códigos ao
longo do tempo, e a pesquisa encontra-a por qualquer um deles.

A pesquisa é pública e não exige conta — qualquer pessoa pode
verificar se uma referência está disponível algures na rede antes de
decidir registar-se para publicar.

## Arquitetura

- **Frontend**: páginas estáticas em HTML/JS puro (sem framework),
  servidas por GitHub Pages.
- **Backend**: Cloudflare Worker, sem servidor tradicional a gerir.
- **Base de dados**: Cloudflare D1 (SQLite na edge).

Sem scraping e sem dependência de terceiros frágeis: a única fonte de
dados externa é a lista pública de concessionários da Renault, usada
apenas para validar registos — importada uma vez, não consultada em
tempo real.

## Decisões de design

- **Validação por telefone + código postal.** O telefone confirma que
  o concessionário é real (cruzado contra a lista oficial). Algumas
  cadeias (ex: Carby, Santogal) usam a mesma central telefónica para
  várias lojas — nesse caso, o código postal desempata qual loja
  exata. Sem ele, o registo fica pendente de confirmação manual em
  vez de o sistema adivinhar.

- **Email confirmado, mas telefone é a identidade forte.** O telefone
  nunca muda depois do registo. O email serve para login e como
  contacto por escrito entre concessionários, mas só fica ativo depois
  de confirmado uma vez — evita que um erro de digitação bloqueie o
  acesso a uma conta que nem chegou a existir de facto.

- **Referências de substituição.** Ao publicar uma peça, é possível
  adicionar códigos alternativos (referência antiga, nova, ou de
  fornecedor diferente). A pesquisa considera todos, não só a
  referência principal — resolve o caso comum de alguém procurar pelo
  código "errado" e não encontrar uma peça que na verdade está lá.

- **Distância entre concessionários.** As coordenadas de cada
  concessionário são geocodificadas uma única vez (endereços não
  mudam de sítio), a partir da lista oficial. Quem está autenticado
  vê a distância a cada peça encontrada, ordenada da mais próxima
  para a mais distante — sem pedir localização GPS a ninguém, já que
  a morada registada já chega.

- **Mapa da rede.** As mesmas coordenadas alimentam uma vista de mapa
  (Leaflet + OpenStreetMap, sem chave de API nem custo) que mostra
  todos os concessionários com stock disponível — um pin por loja,
  com as referências que tem publicadas.

- **Sem scraping.** Ao contrário de abordagens que dependem de extrair
  dados de sites de terceiros (frágil, muda sem aviso, levanta questões
  legais), a única fonte externa usada é a lista pública e oficial de
  concessionários, consultada uma única vez para validação — não há
  nada a "quebrar" quando um site terceiro muda de layout.

## Estado do projeto

Hobby pessoal, em uso ativo. Não é um produto comercial nem aceita
contribuições externas neste momento.

## Gestão

Existe uma página de administração interna, para o criador da
plataforma gerir e corrigir dados diretamente (concessionários,
peças, registo) de forma mais rápida do que editar a base de dados
à mão. Protegida por password; só o criador da plataforma tem acesso.
