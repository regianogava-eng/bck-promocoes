# BCK Beer Chicken - Site de Promoções Delivery

Mini ecommerce estático em HTML, CSS e JavaScript puro, pronto para Netlify.

## Site público

- Página inicial: `/`
- Catálogo editável: `data/catalog.json`
- Painel administrativo: `/admin/`

## Importante sobre o admin

O site anterior era estático, então preço e promoção só mudavam editando arquivo e republicando.
Agora existe um painel `/admin/`, mas para ele salvar alterações no site publicado você precisa publicar via Netlify conectado a um repositório Git e ativar:

1. Netlify Identity
2. Git Gateway
3. Convite de usuário para acessar o admin

Depois disso, entre em:

```text
https://SEU-SITE.netlify.app/admin/
```

Ali você edita:

- ativo/inativo
- título
- descrição
- imagem
- preço original
- preço promocional
- badge
- categorias
- itens do combo
- prioridade de exibição

## Edição rápida sem admin

Se ainda não configurou o admin no Netlify, edite `data/catalog.json` ou `catalog.js` e publique o ZIP novamente.

## Onde trocar dados sensíveis

Edite `config.js`:

- `whatsappNumber`
- `gtmId`
- `ga4Id`
- `metaPixelId`
- integrações futuras de API, pagamento e impressão

## ZIP

Use `bck-beer-chicken-promocoes-netlify.zip` para publicar.
