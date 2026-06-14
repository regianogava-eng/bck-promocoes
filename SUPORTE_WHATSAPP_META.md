# Suporte WhatsApp Meta - caso WABA pendente

## Mensagem pronta para o suporte

Ola, suporte WhatsApp.

Preciso de intervencao tecnica no provisionamento de um numero do WhatsApp Cloud API.

Dados do caso:

- Negocio: Beerchicken Bck / BCK Beer Chicken
- Portfolio de Negocios / Business ID: `320677210600761`
- WhatsApp Manager asset/WABA ID aberto na tela: `2235684346968129`
- WABA ID informado anteriormente: `1035646876076394`
- App ID: `1462881785038522`
- Numero: `+55 28 99984-9520`
- Link da tela de telefones: `https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?asset_id=2235684346968129&business_id=320677210600761`
- Site: `https://beerchicken-bck.netlify.app/`
- Callback configurado: `https://beerchicken-bck.netlify.app/.netlify/functions/whatsapp-webhook`

O Portfolio de Negocios aparece como verificado no Gerenciador de Negocios e sem restricao visivel. O WABA/asset pertence ao negocio correto, e o aplicativo/permissoes administrativas aparecem ativos.

Mesmo assim, a chamada de registro do numero (`/register`) retorna erro dizendo que a conta/WABA nao esta verificada. O numero permanece pendente ha mais de 24 horas.

Solicito que a equipe tecnica force a atualizacao/sincronizacao do status de verificacao e provisionamento do numero na camada do WhatsApp Cloud API.

Tambem existe o caso anterior `1507761040756996`, se ajudar a localizar o historico.

## Checklist antes de enviar

- Confirmar que o app `1462881785038522` tem `whatsapp_business_messaging`.
- Confirmar que o app `1462881785038522` tem `whatsapp_business_management`.
- Confirmar que o usuario do sistema/token tem acesso total ao asset/WABA `2235684346968129`.
- Confirmar que o numero `+55 28 99984-9520` aparece dentro da WABA correta.
- Nunca enviar `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, PIN ou token de usuario em print.

## Diagnostico local

No PowerShell, dentro desta pasta:

```powershell
$env:WHATSAPP_ACCESS_TOKEN="cole_o_token_temporario_aqui"
$env:WHATSAPP_WABA_ID="2235684346968129"
py tools\check_meta_whatsapp.py
Remove-Item Env:\WHATSAPP_ACCESS_TOKEN
Remove-Item Env:\WHATSAPP_WABA_ID
```
