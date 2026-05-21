# BCK Beer Chicken - Promocoes Delivery

Mini ecommerce estatico em HTML, CSS e JavaScript, com carrinho, checkout, painel Decap CMS e base pronta para WhatsApp Cloud API.

## Estrutura principal

- Site publico: `/`
- Admin Decap CMS: `/admin/`
- Catalogo editavel: `data/catalog.json`
- Configuracoes do site: `config.js`
- Pedido API futura: `/.netlify/functions/create-order`
- Webhook WhatsApp: `/.netlify/functions/whatsapp-webhook`

## Admin

O `/admin/` usa Netlify Identity + Git Gateway para salvar alteracoes reais no GitHub.

Edicao disponivel:

- ativo/inativo
- titulo
- descricao
- imagem
- preco original
- preco promocional
- categorias
- badge
- componentes do combo
- prioridade de exibicao

## WhatsApp Cloud API

Nunca coloque token da Meta dentro de `config.js`, `app.js` ou qualquer arquivo publico.

Configure estes segredos no Netlify, em Site configuration > Environment variables:

```text
WHATSAPP_ACCESS_TOKEN=token_permanente_da_meta
WHATSAPP_PHONE_NUMBER_ID=1153856107808696
WHATSAPP_API_VERSION=v25.0
WHATSAPP_VERIFY_TOKEN=crie_um_codigo_secreto_e_repita_na_meta
BCK_STORE_NOTIFY_NUMBER=5528999329677
SITE_URL=https://jovial-vacherin-8c5599.netlify.app
ORDER_WEBHOOK_URL=
META_APP_SECRET=
BCK_OPERATING_HOURS=Todos os dias, das 18h as 23h
```

No painel da Meta, o callback do webhook deve ser:

```text
https://jovial-vacherin-8c5599.netlify.app/.netlify/functions/whatsapp-webhook
```

O verify token deve ser exatamente o mesmo valor de `WHATSAPP_VERIFY_TOKEN`.

Depois de verificar o webhook, assine o evento `messages`.

## Pedido

O checkout continua abrindo o WhatsApp com o pedido completo, que e o caminho mais seguro para vender agora.

Ao mesmo tempo, o site tambem tenta enviar o pedido para:

```text
/.netlify/functions/create-order
```

Esse endpoint esta preparado para:

- encaminhar pedido para Make/n8n via `ORDER_WEBHOOK_URL`
- avisar um numero interno pelo WhatsApp Cloud API
- receber futura integracao com painel, pagamento online e impressao automatica

## Publicacao

Suba somente a pasta `FINAL-BCK-NETLIFY` para o repositorio GitHub conectado ao Netlify.

Nao precisa gerar ZIP.
