// WGCPADDY combined checkout — bundles the whole cart into ONE Stripe payment.
// Requires env var STRIPE_SECRET_KEY set in Netlify (Site settings > Environment variables).
//
// NOTE: Automatic tax must be enabled in your Stripe Dashboard for tax to be charged:
//   Stripe Dashboard > Settings > Tax  (add your tax registration, e.g. Arizona).
// Without a registration, Stripe will not calculate tax.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Server-side price list (source of truth). Prices in CENTS.
// This prevents anyone from editing prices in their browser.
const CATALOG = {
  caps2:     { name: 'WGCPADDY\u00AE Capsules (2-Count)',            cents: 699,  sub: false },
  caps6:     { name: 'WGCPADDY\u00AE Capsules (6-Count)',            cents: 1199, sub: false },
  b30:       { name: 'WGCPADDY\u00AE 30-Count Bottle',               cents: 3999, sub: false },
  sub30:     { name: 'WGCPADDY\u00AE 30-Count Bottle (Subscription)', cents: 3699, sub: true  },
  b60:       { name: 'WGCPADDY\u00AE 60-Count Bottle',               cents: 5999, sub: false },
  sub60:     { name: 'WGCPADDY\u00AE 60-Count Bottle (Subscription)', cents: 5499, sub: true  },
  // Gummies — single and multipacks
  gum_blue:     { name: 'WGCPADDY\u00AE Gummies — Blue Razz (1-Pack)',       cents:  1099, sub: false },
  gum_blue_1:   { name: 'WGCPADDY\u00AE Gummies — Blue Razz (1-Pack)',       cents:  1099, sub: false },
  gum_blue_5:   { name: 'WGCPADDY\u00AE Gummies — Blue Razz (5-Pack)',       cents:  4399, sub: false },
  gum_blue_15:  { name: 'WGCPADDY\u00AE Gummies — Blue Razz (15-Pack)',      cents:  9899, sub: false },
  gum_straw:    { name: 'WGCPADDY\u00AE Gummies — Strawberry Lemonade (1-Pack)', cents: 1099, sub: false },
  gum_straw_1:  { name: 'WGCPADDY\u00AE Gummies — Strawberry Lemonade (1-Pack)', cents: 1099, sub: false },
  gum_straw_5:  { name: 'WGCPADDY\u00AE Gummies — Strawberry Lemonade (5-Pack)', cents: 4399, sub: false },
  gum_straw_15: { name: 'WGCPADDY\u00AE Gummies — Strawberry Lemonade (15-Pack)', cents: 9899, sub: false },
  // Focus Shots — single and multipacks
  shot_blue:    { name: 'WGCPADDY\u00AE Focus Shot — Blue Razz (1-Pack)',    cents:   699, sub: false },
  shot_blue_1:  { name: 'WGCPADDY\u00AE Focus Shot — Blue Razz (1-Pack)',    cents:   699, sub: false },
  shot_blue_8:  { name: 'WGCPADDY\u00AE Focus Shot — Blue Razz (8-Pack)',    cents:  4799, sub: false },
  shot_blue_16: { name: 'WGCPADDY\u00AE Focus Shot — Blue Razz (16-Pack)',   cents:  8399, sub: false },
  shot_blue_32: { name: 'WGCPADDY\u00AE Focus Shot — Blue Razz (32-Pack)',   cents: 13399, sub: false },
  shot_straw:   { name: 'WGCPADDY\u00AE Focus Shot — Strawberry Lemonade (1-Pack)', cents:  699, sub: false },
  shot_straw_1: { name: 'WGCPADDY\u00AE Focus Shot — Strawberry Lemonade (1-Pack)', cents:  699, sub: false },
  shot_straw_8: { name: 'WGCPADDY\u00AE Focus Shot — Strawberry Lemonade (8-Pack)', cents: 4799, sub: false },
  shot_straw_16:{ name: 'WGCPADDY\u00AE Focus Shot — Strawberry Lemonade (16-Pack)', cents: 8399, sub: false },
  shot_straw_32:{ name: 'WGCPADDY\u00AE Focus Shot — Strawberry Lemonade (32-Pack)', cents: 13399, sub: false },
  protein:   { name: 'WGCPADDY\u00AE Organic Pea Protein',           cents: 5999, sub: false },
};

// Shipping rules (in CENTS).
const FREE_SHIP_THRESHOLD = 9000; // $90.00 — free shipping at or above this subtotal
const FLAT_SHIP_CENTS     = 697;  // $6.97 — charged when subtotal is under the threshold

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { items } = JSON.parse(event.body || '{}');
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Cart is empty' }) };
    }

    // Build Stripe line items from the trusted catalog, not the browser prices.
    const line_items = [];
    let hasSubscription = false;
    let subtotalCents = 0;

    for (const item of items) {
      const product = CATALOG[item.id];
      if (!product) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Unknown product: ' + item.id }) };
      }
      const qty = Math.max(1, Math.min(99, parseInt(item.qty, 10) || 1));
      if (product.sub) hasSubscription = true;

      subtotalCents += product.cents * qty;

      line_items.push({
        price_data: {
          currency: 'usd',
          product_data: { name: product.name },
          unit_amount: product.cents,
          ...(product.sub ? { recurring: { interval: 'month' } } : {}),
          // Let Stripe tax this line based on the customer's address.
          tax_behavior: 'exclusive',
        },
        quantity: qty,
      });
    }

    const origin = event.headers.origin || event.headers.referer || 'https://wgcpaddy.com';

    // Decide shipping: free at/above the threshold, otherwise flat rate.
    const qualifiesFreeShip = subtotalCents >= FREE_SHIP_THRESHOLD;
    const shipping_options = [
      qualifiesFreeShip
        ? {
            shipping_rate_data: {
              type: 'fixed_amount',
              fixed_amount: { amount: 0, currency: 'usd' },
              display_name: 'Free Shipping',
              tax_behavior: 'exclusive',
            },
          }
        : {
            shipping_rate_data: {
              type: 'fixed_amount',
              fixed_amount: { amount: FLAT_SHIP_CENTS, currency: 'usd' },
              display_name: 'Standard Shipping',
              tax_behavior: 'exclusive',
            },
          },
    ];

    const session = await stripe.checkout.sessions.create({
      mode: hasSubscription ? 'subscription' : 'payment',
      line_items,
      success_url: origin.replace(/\/$/, '') + '/?checkout=success',
      cancel_url: origin.replace(/\/$/, '') + '/?checkout=cancel',
      shipping_address_collection: { allowed_countries: ['US'] },
      ...(hasSubscription ? {} : { shipping_options }),
      automatic_tax: { enabled: true },
      ...(hasSubscription ? {} : { allow_promotion_codes: true }),
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('Checkout error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
