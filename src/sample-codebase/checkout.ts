import flagsmith from 'flagsmith';

export interface CheckoutRequest {
  orderId: string;
  amount: number;
  currency: string;
}

export async function processPayment(req: CheckoutRequest) {
  console.log(`[Checkout] Processing order: ${req.orderId} for ${req.amount} ${req.currency}`);

  // STALE FLAG: Fast checkout was rolled out to 100% of users 105 days ago
  if (flagsmith.hasFeature('fast_checkout_stripe')) {
    console.log('[Stripe] Executing ultra-low latency direct charge with Apple Pay/Google Pay tokens');
    return {
      status: 'SUCCESS',
      provider: 'stripe_express_v2',
      transactionId: `txn_${Date.now()}`,
    };
  } else {
    console.log('[Legacy] Fallback to redirect payment gateway');
    return {
      status: 'SUCCESS',
      provider: 'legacy_redirect_v1',
      transactionId: `legacy_${Date.now()}`,
    };
  }
}
