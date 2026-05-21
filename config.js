window.BCK_CONFIG = {
  storeName: "BCK Beer Chicken",
  city: "Cachoeiro",
  whatsappNumber: "5528999329677",
  siteUrl: "https://jovial-vacherin-8c5599.netlify.app",
  currency: "BRL",
  deliveryFee: 0,
  automation: {
    enabled: true,
    orderPrefix: "BCK",
    operatingHours: "Todos os dias, das 18h as 23h",
    estimatedPrepMinutes: 35,
    estimatedDeliveryMinutes: 55,
    autoConfirmText: "Pedido recebido automaticamente pelo site. Se os dados estiverem certos, ja pode seguir para preparo.",
    customerNextStepText: "Depois de enviar, acompanhe por este WhatsApp. Se escolher Pix, envie o comprovante na mesma conversa.",
    pix: {
      enabled: true,
      key: "CADASTRE_A_CHAVE_PIX",
      receiverName: "BCK Beer Chicken",
      instructions: "Faca o Pix no valor total e envie o comprovante pelo WhatsApp."
    },
    card: {
      instructions: "Levar maquininha para pagamento na entrega."
    },
    cash: {
      instructions: "Informe no campo observacoes se precisa de troco."
    },
    whatsappBusiness: {
      greetingMessage: "Oi! Eu sou o atendimento automatico da BCK. Envie seu pedido pelo site para agilizar.",
      awayMessage: "Recebemos sua mensagem. Para pedido mais rapido, use o site e envie o carrinho pronto.",
      quickReplies: [
        "Ver promocoes de hoje",
        "Montar combo",
        "Enviar endereco",
        "Falar sobre meu pedido"
      ]
    },
    apiReady: {
      whatsappCloudApi: false,
      n8nWebhookUrl: "",
      makeWebhookUrl: "",
      whatsappWebhookUrl: "/.netlify/functions/whatsapp-webhook",
      orderApiUrl: "/.netlify/functions/create-order",
      paymentApiUrl: "",
      printerWebhookUrl: ""
    }
  },
  placeholders: {
    gtmId: "GTM-XXXXXXX",
    ga4Id: "G-XXXXXXXXXX",
    metaPixelId: "000000000000000"
  },
  messages: {
    defaultWhatsapp: "Oi, BCK! Vim pelo site de promocoes e quero fazer um pedido."
  },
  futureIntegrations: {
    apiBaseUrl: "",
    paymentProvider: "",
    printerWebhook: "",
    adminPanelUrl: ""
  }
};

window.dataLayer = window.dataLayer || [];
