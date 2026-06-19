# BCK Beer Chicken - Estrutura do mini site, Bibi e rastreamento

Documento preparado para entendimento do Gemini/Google ou outro programador.

Objetivo do sistema:
- Mini site de promocoes da BCK Beer Chicken.
- Cliente monta pedido/carrinho no site.
- Checkout abre WhatsApp com pedido organizado.
- Bibi atende pelo WhatsApp Cloud API, interpreta pedidos simples e encaminha para humano conferir.
- Atendente confirma o pedido e envia link `/obrigado`.
- Clique em `/obrigado` registra compra real no evento `Purchase_WhatsApp`.

URL de producao:
- `https://beerchicken-bck.netlify.app`

Pixel Meta:
- `746956188164996`

Numero da equipe/loja:
- `5528999329677`

Numero oficial da Bibi Cloud API:
- `5528999849520`

---

## 1. Arvore do projeto

```text
bck-promocoes/
  404.html
  _redirects
  admin.css
  admin.js
  app.js
  config.js
  create-order.js
  decap.html
  index.html
  netlify.toml
  obrigado.html
  package.json
  privacidade.html
  README.md
  SUPORTE_WHATSAPP_META.md

  admin/
    admin.css
    admin.js
    config.yml
    decap.html
    index.html

  assets/
    images/
      bck-mascot-logo.png
      combo-frango-batata-cerveja.png
      combo-frango-batata-cerveja.webp
      combo-frango-pizza.png
      combo-frango-pizza.webp
      combo-pizza-refri.png
      combo-pizza-refri.webp
      hero-bck-feast.png
      hero-bck-feast.webp
      hero-bck-feast-mobile.webp

  data/
    catalog.json

  netlify/
    functions/
      create-order.js
      get-catalog.js
      save-catalog.js
      whatsapp-webhook.js

  tools/
    check_meta_whatsapp.py
    register_whatsapp_phone.py
```

Arquivos antigos/documentos locais que nao fazem parte do runtime principal:
- `BIBI_ESPECIFICACAO_ATENDIMENTO.txt`
- `LOGICA_COMPLETA_SITE_BIBI_CHECKOUT.txt`
- `netlify/functions/SUBIR-ESTE-ARQUIVO-DENTRO-DE-NETLIFY-FUNCTIONS/create-order.js`

---

## 2. Paginas principais

### `/` - `index.html`

Pagina principal do mini site.

Seções principais:
- Hero com marca BCK e chamada para ofertas.
- Vitrine/catalogo de produtos.
- Montador de combo.
- Carrinho lateral.
- Contato/endereco/redes sociais.
- Checkout pelo WhatsApp.
- Botao para falar com a Bibi.

Arquivos usados:
- `index.html`: estrutura HTML.
- `styles.css`: visual.
- `app.js`: comportamento, carrinho, checkout e rastreamento.
- `config.js`: configuracoes do negocio, pixel e URLs.
- `data/catalog.json`: produtos, categorias, horarios e montador de combo.

### `/obrigado` - `obrigado.html`

Pagina de pedido confirmado.

Uso correto:
- Atendente so deve enviar esse link depois de confirmar pedido, valor, prazo, endereco e disponibilidade.
- Quando o cliente clica, dispara o evento de compra real `Purchase_WhatsApp`.

Exemplo de link com protocolo:

```text
https://beerchicken-bck.netlify.app/obrigado?pedido=BIBI-260617123456-ABCD
```

Parametro aceito:
- `pedido`
- `protocolo`
- `valor` ou `value`

### `/privacidade.html`

Pagina de politica/privacidade e contato.

### `/admin`

Area/admin do catalogo.

Arquivos:
- `admin/index.html`
- `admin/config.yml`
- `admin/admin.js`
- `admin/admin.css`

---

## 3. Configuracao principal - `config.js`

Objeto global:

```js
window.BCK_CONFIG = {
  storeName: "BCK Beer Chicken",
  city: "Cachoeiro",
  whatsappNumber: "5528999329677",
  siteUrl: "https://beerchicken-bck.netlify.app",
  currency: "BRL",
  marketing: {
    metaEvents: {
      checkoutLead: "Lead_Checkout_WhatsApp"
    }
  },
  automation: {
    aiAssistant: {
      enabled: true,
      name: "Bibi",
      whatsappNumber: "5528999849520",
      provider: "whatsapp-cloud-api"
    },
    apiReady: {
      whatsappWebhookUrl: "/.netlify/functions/whatsapp-webhook",
      orderApiUrl: "/.netlify/functions/create-order"
    }
  },
  placeholders: {
    metaPixelId: "746956188164996"
  }
}
```

Pontos importantes:
- `whatsappNumber` e o numero da loja/equipe.
- `automation.aiAssistant.whatsappNumber` e o numero da Bibi.
- `metaPixelId` e o Pixel da Meta.
- `checkoutLead` define o evento customizado de lead do checkout.

---

## 4. Catalogo - `data/catalog.json`

Contem:
- Categorias.
- Produtos ativos/inativos.
- Horario de funcionamento.
- Montador de combo.
- Produtos-base.
- Grupo de promocoes.
- Fidelidade.

Categorias atuais:
- todos
- combos
- frango
- pizza
- batata
- porcoes-carne
- bebidas
- hamburguer

Horario atual:
- Todos os dias.
- Abertura: `17:00`.
- Fechamento: `00:00`.
- Corte: `23:30`.
- Checkout bloqueia se estiver fechado.

Montador de combo:
- Pizza.
- Frango.
- Batata.
- Bebida.
- Combo acima de R$100 libera refri gratis.

---

## 5. Frontend - `app.js`

Responsabilidades:
- Carregar catalogo.
- Renderizar produtos.
- Renderizar categorias.
- Renderizar combo builder.
- Controlar carrinho.
- Montar payload do pedido.
- Montar mensagem de WhatsApp.
- Enviar pedido para API `/create-order`.
- Abrir WhatsApp da equipe com pedido pronto.
- Disparar eventos de rastreamento.
- Abrir Bibi no WhatsApp.

Hooks expostos em runtime:

```js
window.BCK_STORE = {
  config,
  catalog,
  getCart,
  addToCart,
  addCustomComboToCart,
  removeFromCart,
  changeQuantity,
  buildOrderPayload,
  buildOrderMessage,
  buildAssistantMessage,
  openAiAssistant,
  submitOrderToApi,
  getScheduleStatus,
  trackEvent
}
```

Fluxo do checkout no site:

```text
Cliente adiciona itens ao carrinho
  -> clica em checkout
  -> preenche nome, telefone, endereco, pagamento e observacao
  -> clica "Enviar pedido completo"
  -> app.js monta order
  -> app.js dispara rastreamentos de checkout/lead
  -> app.js envia order para /.netlify/functions/create-order
  -> app.js abre WhatsApp da equipe com mensagem pronta
  -> equipe confirma manualmente
  -> equipe manda link /obrigado
  -> cliente clica /obrigado
  -> dispara Purchase_WhatsApp
```

---

## 6. Backend Netlify Functions

### `/.netlify/functions/create-order`

Arquivo:
- `netlify/functions/create-order.js`

Metodo:
- `POST`

Entrada:
- Pedido criado no checkout do site.

Responsabilidades:
- Validar pedido.
- Criar/usar ID do pedido.
- Salvar/atualizar historico de fidelidade via Netlify Blobs.
- Enviar notificacao para a loja pelo WhatsApp Cloud API.
- Opcionalmente enviar webhook externo.
- Opcionalmente enviar para impressora.
- Montar mensagem pronta para o atendente enviar ao cliente com `/obrigado`.

Mensagem adicionada na notificacao da equipe:

```text
MENSAGEM PRONTA PARA ENVIAR AO CLIENTE:
Use somente depois de confirmar valor, prazo, endereco e disponibilidade.

Seu pedido foi confirmado!

Para finalizar sua confirmacao, clique no link abaixo:
https://beerchicken-bck.netlify.app/obrigado?pedido=BCK-...

Obrigado por pedir com a BCK Beer Chicken.
```

### `/.netlify/functions/whatsapp-webhook`

Arquivo:
- `netlify/functions/whatsapp-webhook.js`

Metodo:
- `GET`: verificacao do webhook Meta e endpoints de saude/log.
- `POST`: recebe mensagens/status do WhatsApp Cloud API.

Responsabilidades:
- Validar assinatura Meta quando configurada.
- Receber mensagens enviadas para a Bibi.
- Controlar estado da conversa.
- Interpretar pedido.
- Usar OpenAI quando habilitado.
- Consultar CEP quando necessario.
- Salvar sessoes e pedidos em Netlify Blobs.
- Enviar resumo do pedido para a equipe.
- Registrar logs de notificacao.
- Avisar cliente se envio para a equipe falhar.

Versao atual da Bibi:

```text
2026-06-17-confirmation-link-v1
```

Estados principais da Bibi:

```text
MENU
COLETANDO_PEDIDO
CONFIRMANDO_PEDIDO
ENCAMINHADO_PARA_EQUIPE
```

Fluxo Bibi:

```text
Cliente chama Bibi
  -> Bibi mostra menu ou entende intencao
  -> se cliente quer pedir, Bibi coleta:
       nome
       endereco
       itens
       pagamento
       troco, se dinheiro
  -> Bibi resume pedido
  -> cliente confirma
  -> Bibi salva pedido em bck-bibi-orders
  -> Bibi envia pedido para numero da equipe 5528999329677
  -> mensagem para equipe inclui texto pronto do /obrigado
  -> equipe confere manualmente
  -> equipe manda link /obrigado ao cliente
  -> clique no link vira Purchase_WhatsApp
```

### `/.netlify/functions/get-catalog`

Arquivo:
- `netlify/functions/get-catalog.js`

Responsabilidade:
- Buscar catalogo salvo em Netlify Blobs quando existir.
- Caso nao exista, frontend usa `data/catalog.json`.

### `/.netlify/functions/save-catalog`

Arquivo:
- `netlify/functions/save-catalog.js`

Responsabilidade:
- Salvar catalogo.
- Requer token/admin.

---

## 7. Variaveis de ambiente importantes

Nao colocar valores secretos neste documento.

### WhatsApp/Meta

```text
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_API_VERSION
WHATSAPP_VERIFY_TOKEN
META_APP_SECRET
BCK_STORE_NOTIFY_NUMBER
```

### OpenAI / IA da Bibi

```text
OPENAI_API_KEY
OPENAI_BASE_URL
BCK_AI_INTERPRETER_ENABLED
BCK_AI_INTERPRETER_MODEL
```

Modelo atual:

```text
gpt-4o-mini
```

### Netlify Blobs

```text
BCK_BLOBS_SITE_ID
BCK_BLOBS_TOKEN
NETLIFY_SITE_ID
NETLIFY_BLOBS_TOKEN
NETLIFY_AUTH_TOKEN
```

### Logs/Admin

```text
BCK_NOTIFY_LOG_TOKEN
BCK_ADMIN_TOKEN
```

### Outros opcionais

```text
ORDER_WEBHOOK_URL
BCK_PRINTER_WEBHOOK_URL
PRINTER_WEBHOOK_URL
ORDER_PRINTER_WEBHOOK_URL
LOYALTY_SEND_CUSTOMER_WHATSAPP
LOYALTY_PURCHASE_TARGET
LOYALTY_REWARD_TITLE
SITE_URL
URL
```

---

## 8. Rastreamento completo

### Instalacao Meta Pixel

Arquivo:
- `app.js`
- `obrigado.html`

Pixel:

```text
746956188164996
```

O pixel e instalado via `fbq`.

### `dataLayer`

O site tambem envia eventos para:

```js
window.dataLayer.push(...)
```

Se GTM/GA4 estiverem configurados no futuro, os eventos ja estao preparados.

### Eventos no site principal

#### `page_view`

Quando:
- No carregamento da pagina principal.

Origem:
- `app.js -> init() -> trackEvent("page_view")`

Destino:
- dataLayer
- gtag, se existir
- Meta Pixel como custom event se aplicavel

#### `PageView`

Quando:
- Instalacao do Meta Pixel.

Origem:
- `installMetaPixel()`

Destino:
- Meta Pixel standard event.

#### `click`

Quando:
- Clique em elemento com `data-track-click`.

Exemplos:

```html
data-track-click="hero_ver_ofertas"
data-track-click="hero_checkout"
data-track-click="hero_ai_assistant"
data-track-click="contact_whatsapp_orders"
data-track-click="contact_phone_store"
data-track-click="contact_address_maps"
data-track-click="social_instagram"
data-track-click="social_facebook"
data-track-click="checkout_ai_assistant"
```

Payload:
- `label`
- `click_label`
- `click_text`
- `click_url`

#### `view_item`

Quando:
- Cliente visualiza/detalha item.

Meta standard:
- `ViewContent`

Meta custom:
- `BCK_view_item`

#### `add_to_cart`

Quando:
- Cliente adiciona produto ao carrinho.
- Cliente adiciona combo montado.

Meta standard:
- `AddToCart`

Meta custom:
- `BCK_add_to_cart`

#### `begin_checkout`

Quando:
- Cliente clica para ir ao checkout.

Meta standard:
- `InitiateCheckout`

Meta custom:
- `BCK_begin_checkout`

#### `lead`

Quando:
- Cliente envia pedido completo pelo checkout.
- Cliente abre Bibi em alguns pontos.

Meta standard:
- `Lead`

#### `Lead_Checkout_WhatsApp`

Quando:
- Cliente clica em "Enviar pedido completo" no checkout e o site abre WhatsApp com o pedido.

Objetivo:
- Medir quem virou lead/intencao de pedido no WhatsApp.

Meta:
- Custom event.
- Tambem existe conversao personalizada `lead_Checkout_WhatsApp`.

Payload principal:
- `value`
- `payment_type`
- `order_id`
- `content_name: "Checkout WhatsApp BCK"`
- `content_type: "checkout"`
- itens do pedido

### Evento de compra real

#### `Purchase_WhatsApp`

Quando:
- Cliente clica no link `/obrigado` depois que o atendente confirmou o pedido.

Origem:
- `obrigado.html`

Destino:
- dataLayer:

```js
{
  event: "Purchase_WhatsApp",
  order_id: "...",
  value: ...,
  currency: "BRL",
  source: "obrigado_page"
}
```

- Meta Pixel:

```js
fbq("trackCustom", "Purchase_WhatsApp", payload, { eventID })
```

Conversao personalizada na Meta:
- Nome: `Purchase_WhatsApp`
- ID: `2019941748881538`
- Fonte: `pixel bck`
- Regra: URL contem `/obrigado`
- Categoria: `Compra`

### Eventos da pagina `/obrigado`

#### `obrigado_click`

Quando:
- Cliente clica em botao da pagina de obrigado.

Exemplos:
- `order_again`
- `whatsapp_followup`

#### `BCK_obrigado_click`

Quando:
- Mesmo clique acima, enviado ao Meta Pixel como evento customizado BCK.

---

## 9. Ponto de atencao sobre rastreamento

O fluxo desejado para Meta Ads e:

```text
Lead_Checkout_WhatsApp = clique no checkout / abriu WhatsApp
Purchase_WhatsApp = cliente clicou em /obrigado depois de pedido confirmado
```

Ponto tecnico corrigido em 19/06/2026:
- Em `app.js`, dentro de `submitOrder()`, o checkout nao dispara mais `trackEvent("purchase", ...)`.
- O checkout mantem `lead` e `Lead_Checkout_WhatsApp`.
- A compra real fica reservada para `Purchase_WhatsApp` na pagina `/obrigado`.

Nao alterar campanha sem planejamento.
Campanha atual deve continuar otimizada para conversoes/leads enquanto acumula dados de `Purchase_WhatsApp`.

---

## 10. Fluxo de campanhas

Campanha atual:
- Objetivo: maximizar conversoes.
- Evento principal atual: lead/check-out do WhatsApp.
- Nao mexer sem cuidado para nao quebrar aprendizado.

Fluxo de aprendizado novo:

```text
1. Cliente clica no checkout
   -> Lead_Checkout_WhatsApp

2. Cliente conversa no WhatsApp
   -> equipe confirma pedido

3. Atendente envia /obrigado
   -> cliente clica
   -> Purchase_WhatsApp

4. Meta passa a ter dois sinais:
   -> lead
   -> compra real

5. Depois de acumular dados, pode criar campanha/grupo novo otimizado para Purchase_WhatsApp.
```

---

## 11. Mensagem pronta que chega para a equipe

Pedidos da Bibi e pedidos do checkout incluem uma instrucao para o atendente:

```text
MENSAGEM PRONTA PARA ENVIAR AO CLIENTE:
Use somente depois de confirmar valor, prazo, endereco e disponibilidade.

Seu pedido foi confirmado!

Para finalizar sua confirmacao, clique no link abaixo:
https://beerchicken-bck.netlify.app/obrigado?pedido=PROTOCOLO

Obrigado por pedir com a BCK Beer Chicken.
```

O objetivo e:
- facilitar para o atendente;
- evitar ele ter que salvar link;
- registrar compra real no Pixel somente depois da confirmacao.

---

## 12. Netlify

`netlify.toml`:

```toml
[build]
  publish = "."
  command = ""

[functions]
  directory = "netlify/functions"
```

Rotas em `_redirects`:

```text
/obrigado /obrigado.html 200
/obrigado/ /obrigado.html 200
```

Protecoes:
- Bloqueia leitura publica de arquivos sensiveis/documentacao:
  - `/README.md`
  - `/SUPORTE_WHATSAPP_META.md`
  - `/tools/*`
  - `/*.py`
  - `/.netlify/*`

---

## 13. Prompt para colar no Gemini

```text
Voce e um arquiteto de ecommerce, rastreamento Meta Ads e WhatsApp Cloud API.

Analise a estrutura abaixo do mini site BCK Beer Chicken.

Objetivo do negocio:
- Maximizar pedidos pelo mini site.
- Medir corretamente leads e compras reais.
- Nao misturar lead com compra.
- Bibi deve ajudar no WhatsApp, mas humano confirma pedido.

Regra de rastreamento:
- Lead_Checkout_WhatsApp = clique no botao "Enviar pedido completo" e abertura do WhatsApp.
- Purchase_WhatsApp = somente clique em /obrigado depois que o atendente confirmou pedido.
- /obrigado nunca deve disparar Lead_Checkout_WhatsApp.
- Checkout nao deve contar compra real se ainda nao houve confirmacao humana.

Tarefa:
1. Explique o funcionamento do site.
2. Aponte riscos no rastreamento.
3. Sugira melhorias sem quebrar a campanha atual.
4. Sugira estrutura ideal de eventos Meta/GA4/GTM.
5. Sugira melhoria de funil: clique -> WhatsApp -> confirmacao -> /obrigado -> compra.
6. Nao sugira alterar objetivo/orcamento/campanha atual sem plano de transicao.
7. Nao pedir nem expor tokens/chaves.

Contexto tecnico:
[cole este documento inteiro abaixo]
```

---

## 14. Resumo executivo

O mini site tem tres blocos principais:

```text
Frontend do pedido:
index.html + app.js + catalog.json

Backend do pedido:
create-order.js + Netlify Blobs + WhatsApp Cloud API

Bibi:
whatsapp-webhook.js + OpenAI + CEP + logs + notificacao para equipe
```

O rastreamento correto para negocio e:

```text
Lead_Checkout_WhatsApp
  = intencao de pedido

Purchase_WhatsApp
  = pedido confirmado pelo humano e validado pelo clique em /obrigado
```

Prioridade recomendada:
1. Manter campanha atual rodando.
2. Acumular dados em `Purchase_WhatsApp`.
3. Revisar se o checkout ainda deve disparar evento standard `Purchase`.
4. Depois criar grupo/campanha nova otimizada para compra real.
