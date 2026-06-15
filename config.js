window.BCK_CONFIG = {
  storeName: "BCK Beer Chicken",
  city: "Cachoeiro",
  whatsappNumber: "5528999329677",
  siteUrl: "https://beerchicken-bck.netlify.app",
  currency: "BRL",
  deliveryFee: 0,
  marketing: {
    orderCutoffTime: "23:30",
    closeTime: "00:00",
    firstOrder: {
      enabled: true,
      title: "Primeiro pedido pela BCK?",
      description: "Monte o carrinho no site e envie tudo organizado para a equipe confirmar no WhatsApp."
    },
    proof: [
      "Pedidos chegam com itens, endereco e pagamento organizados.",
      "Combo montado acima de R$100 libera refri gratis automaticamente.",
      "Bibi ajuda no primeiro contato e encaminha para a equipe responsavel."
    ],
    metaEvents: {
      checkoutLead: "Lead_Checkout_WhatsApp"
    }
  },
  automation: {
    enabled: true,
    orderPrefix: "BCK",
    operatingHours: "Todos os dias, das 17h as 00h",
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
    aiAssistant: {
      enabled: true,
      name: "Bibi",
      label: "Conversar com a Bibi",
      shortLabel: "Bibi IA",
      headline: "Fale com a Bibi",
      description: "A atendente virtual da BCK ajuda a escolher combo, tirar duvida de entrega e continuar seu atendimento.",
      whatsappNumber: "5528999849520",
      whatsappMessage: "Oi, Bibi! Vim pelo mini site e quero ajuda para escolher meu pedido.",
      handoffKeyword: "BIBI",
      provider: "whatsapp-cloud-api"
    },
    apiReady: {
      whatsappCloudApi: true,
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
    metaPixelId: "746956188164996"
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
