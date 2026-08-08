import { prisma } from '../services/db.js';
import {
  queueBillingCheck,
  reconcileOverdueInvoices,
  recordFailedPayment,
} from '../services/billingLifecycleService.js';

async function resolveOrder(req, overrides = {}) {
  const checkoutOrderId = overrides.checkoutOrderId
    || req.body?.checkoutOrderId
    || req.body?.orderId
    || (req.params?.orderId && !String(req.params.orderId).startsWith('PAYID-') ? req.params.orderId : null);
  if (checkoutOrderId) {
    const order = await prisma.checkoutOrder.findUnique({ where: { id: checkoutOrderId } });
    if (order) return order;
  }
  const providerOrderId = overrides.providerOrderId
    || req.body?.paypalOrderId
    || req.body?.providerOrderId
    || req.body?.orderId
    || req.params?.paypalOrderId
    || null;
  if (providerOrderId) {
    return prisma.checkoutOrder.findFirst({ where: { providerOrderId } });
  }
  return null;
}

/**
 * Attaches a billing lifecycle context to a payment request.
 *
 * Route handlers can call `await req.billing.fail(error)` in their catch path.
 * After every response, a non-blocking reconciliation confirms that successful
 * provider results have matching transaction and service-access records.
 */
export function paymentLifecycleMiddleware({ provider = 'paypal', source = 'payment_route' } = {}) {
  return function attachPaymentLifecycle(req, res, next) {
    let explicitlyTracked = false;
    let resolvedOrderId = null;
    req.billing = {
      async order(overrides = {}) {
        const order = await resolveOrder(req, overrides);
        if (order) resolvedOrderId = order.id;
        return order;
      },
      async fail(error, overrides = {}) {
        explicitlyTracked = true;
        try {
          const order = overrides.order || await resolveOrder(req, overrides);
          if (!order) return null;
          resolvedOrderId = order.id;
          return await recordFailedPayment({
            order,
            provider: overrides.provider || provider,
            providerTransactionId: overrides.providerTransactionId || null,
            paymentMethodId: overrides.paymentMethodId || req.body?.paymentMethodId || null,
            error,
            source,
          });
        } catch (trackingError) {
          console.error('[billing] failed to track payment failure:', trackingError.message);
          return null;
        }
      },
    };

    res.once('finish', () => {
      setImmediate(async () => {
        try {
          const order = resolvedOrderId
            ? await prisma.checkoutOrder.findUnique({ where: { id: resolvedOrderId } })
            : await resolveOrder(req);
          if (!order) return;
          if (res.statusCode >= 400 && !explicitlyTracked) {
            await recordFailedPayment({
              order,
              provider,
              error: Object.assign(new Error('Payment request was unsuccessful.'), { code: `HTTP_${res.statusCode}` }),
              source: `${source}:response`,
            });
          }
          queueBillingCheck(order.id);
        } catch (error) {
          console.error('[billing] response reconciliation failed:', error.message);
        }
      });
    });
    next();
  };
}

/** Refresh overdue invoice state before serving a billing read. */
export async function invoiceStatusCheckMiddleware(req, _res, next) {
  try {
    await reconcileOverdueInvoices({ userId: req.user?.id && req.user.id !== 'local-user' ? req.user.id : null });
  } catch (error) {
    console.error('[billing] invoice status check failed:', error.message);
  }
  next();
}

export default { paymentLifecycleMiddleware, invoiceStatusCheckMiddleware };
