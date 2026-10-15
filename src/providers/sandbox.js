export default {
  name: "sandbox",

  async createPayment(payment, { publicOrigin }) {
    return {
      reference: `sb_${payment.id}`,
      checkoutUrl: `${publicOrigin}/checkout/${encodeURIComponent(payment.id)}`,
      providerData: { mode: "sandbox" },
    };
  },

  async normalizeWebhook() {
    throw new Error("Provider sandbox tidak menerima webhook eksternal.");
  },
};
