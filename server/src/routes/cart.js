// =============================================================================
// /api/cart — session-token based shopping cart (public, no auth)
// Client sends its cart token via the X-Cart-Token header once issued.
//
// Two line-item types share this cart: shop products (item_type='product')
// and event tickets (item_type='event_ticket'). A ticket item is a *hold*,
// not a confirmed sale — hold_expires_at gives the shopper a checkout window
// (HOLD_MINUTES) during which the ticket counts against the type's
// capacity. There's no cron/cleanup job: an expired hold simply stops
// counting in computeTicketAvailable()'s query, and cartPayload() lazily
// deletes this cart's own expired holds whenever it's fetched.
// =============================================================================
const router = require('express').Router();
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { db } = require('../db');

const HOLD_MINUTES = 15;

// Security remediation H-07 — no limit meant an attacker could exhaust
// ticket-hold capacity (denial of inventory) with repeated adds, holding
// nothing back for real shoppers.
const cartItemsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

async function getOrCreateCart(req) {
  const token = req.headers['x-cart-token'];
  if (token) {
    const [[cart]] = await db.query('SELECT * FROM carts WHERE session_key = :token', { token });
    if (cart) return cart;
  }
  const session_key = crypto.randomBytes(32).toString('hex');
  const [ins] = await db.query('INSERT INTO carts (session_key) VALUES (:session_key)', { session_key });
  return { id: ins.insertId, session_key };
}

// Available = ticket type's capacity minus confirmed registrations minus
// currently-held (unexpired) cart quantity across ALL shoppers' carts.
// NULL capacity means unlimited — always available.
//
// Compares against an app-computed `now` (a JS Date, bound as a parameter)
// rather than SQL NOW() — the pool connects with `timezone: 'Z'`, so mysql2
// serializes/deserializes Date values as UTC, but MySQL's own NOW() runs in
// the server's session timezone (whatever the host's `SYSTEM` tz is, often
// NOT UTC). Comparing hold_expires_at (written via a JS Date, i.e. UTC per
// the driver) against SQL NOW() (server-local) silently mismatches by the
// server's UTC offset — holds appeared to last ~5 hours instead of 15
// minutes locally. Binding `now` the same way hold_expires_at itself is
// written keeps both sides in the same clock.
async function computeTicketAvailable(ticketTypeId, { excludeCartId } = {}) {
  const now = new Date();
  const [[row]] = await db.query(
    `SELECT ett.capacity,
            (SELECT COALESCE(SUM(er.quantity), 0) FROM event_registrations er
              WHERE er.ticket_type_id = ett.id AND er.status = 'registered') AS registered,
            (SELECT COALESCE(SUM(ci.qty), 0) FROM cart_items ci
              WHERE ci.ticket_type_id = ett.id AND ci.item_type = 'event_ticket'
                AND ci.hold_expires_at > :now
                ${excludeCartId ? 'AND ci.cart_id != :excludeCartId' : ''}) AS held
       FROM event_ticket_types ett WHERE ett.id = :ticketTypeId`,
    { ticketTypeId, excludeCartId, now }
  );
  if (!row || row.capacity == null) return null; // unlimited
  return Math.max(0, row.capacity - row.registered - row.held);
}

// Deletes THIS cart's own expired ticket holds so a stale item doesn't linger
// in what the shopper sees — other shoppers' expired holds age out the same
// way next time their own cart is fetched. See computeTicketAvailable's
// comment above for why `now` is bound as a JS Date rather than using NOW().
async function purgeExpiredHolds(cartId) {
  const now = new Date();
  await db.query(
    `DELETE FROM cart_items WHERE cart_id = :cartId AND item_type = 'event_ticket' AND hold_expires_at <= :now`,
    { cartId, now }
  );
}

async function cartPayload(cart) {
  await purgeExpiredHolds(cart.id);

  const [productItems] = await db.query(
    `SELECT ci.id, 'product' AS item_type, ci.product_id, NULL AS ticket_type_id, ci.qty, ci.unit_price,
       p.name, p.slug, p.stock_qty, p.track_inventory, p.weight_oz, p.taxable, p.is_active,
       NULL AS hold_expires_at, NULL AS event_name, NULL AS event_slug,
       (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1) AS image_url
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = :cart_id AND ci.item_type = 'product' ORDER BY ci.id`,
    { cart_id: cart.id }
  );
  const [ticketItems] = await db.query(
    `SELECT ci.id, 'event_ticket' AS item_type, NULL AS product_id, ci.ticket_type_id, ci.qty, ci.unit_price,
       ett.name, NULL AS slug, NULL AS stock_qty, 1 AS track_inventory, NULL AS weight_oz, 0 AS taxable, ett.is_active,
       ci.hold_expires_at, e.name AS event_name, e.slug AS event_slug, NULL AS image_url
     FROM cart_items ci
       JOIN event_ticket_types ett ON ett.id = ci.ticket_type_id
       JOIN events e ON e.id = ett.event_id
     WHERE ci.cart_id = :cart_id AND ci.item_type = 'event_ticket' ORDER BY ci.id`,
    { cart_id: cart.id }
  );

  const items = [...productItems, ...ticketItems].sort((a, b) => a.id - b.id);
  const subtotal = items.reduce((sum, it) => sum + Number(it.unit_price) * it.qty, 0);
  return { session_key: cart.session_key, items, subtotal: Math.round(subtotal * 100) / 100 };
}

router.get('/', async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req);
    res.json(await cartPayload(cart));
  } catch (err) { next(err); }
});

router.post('/items', cartItemsLimiter, async (req, res, next) => {
  try {
    const { product_id, ticket_type_id, qty = 1 } = req.body;
    if (!product_id && !ticket_type_id) return res.status(400).json({ error: 'product_id or ticket_type_id required' });
    const cart = await getOrCreateCart(req);

    if (ticket_type_id) {
      const [[ticket]] = await db.query(
        `SELECT ett.id, ett.price, ett.is_active AS ticket_active, e.is_active AS event_active
           FROM event_ticket_types ett JOIN events e ON e.id = ett.event_id WHERE ett.id = :id`,
        { id: ticket_type_id }
      );
      if (!ticket || !ticket.ticket_active || !ticket.event_active) return res.status(404).json({ error: 'Ticket type not found' });

      const [[existing]] = await db.query(
        `SELECT id, qty FROM cart_items WHERE cart_id = :cart_id AND item_type = 'event_ticket' AND ticket_type_id = :ticket_type_id`,
        { cart_id: cart.id, ticket_type_id }
      );
      const addQty = Number(qty);
      // Availability excludes this cart's own existing hold on the same ticket
      // type, since we're about to replace it with the new total anyway.
      const available = await computeTicketAvailable(ticket_type_id, { excludeCartId: cart.id });
      const newQty = (existing?.qty || 0) + addQty;
      if (available != null && newQty > available) {
        return res.status(400).json({ error: `Only ${available} ticket(s) left` });
      }
      const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
      if (existing) {
        await db.query('UPDATE cart_items SET qty = :qty, hold_expires_at = :hold WHERE id = :id',
          { id: existing.id, qty: newQty, hold: holdExpiresAt });
      } else {
        await db.query(
          `INSERT INTO cart_items (cart_id, item_type, ticket_type_id, qty, unit_price, hold_expires_at)
           VALUES (:cart_id, 'event_ticket', :ticket_type_id, :qty, :unit_price, :hold)`,
          { cart_id: cart.id, ticket_type_id, qty: newQty, unit_price: ticket.price, hold: holdExpiresAt }
        );
      }
      return res.json(await cartPayload(cart));
    }

    const [[product]] = await db.query('SELECT price, is_active, track_inventory, stock_qty FROM products WHERE id = :id', { id: product_id });
    if (!product || !product.is_active) return res.status(404).json({ error: 'Product not found' });

    const [[existing]] = await db.query(
      `SELECT id, qty FROM cart_items WHERE cart_id = :cart_id AND item_type = 'product' AND product_id = :product_id`,
      { cart_id: cart.id, product_id }
    );
    const newQty = (existing?.qty || 0) + Number(qty);
    if (product.track_inventory && newQty > product.stock_qty) {
      return res.status(400).json({ error: `Only ${product.stock_qty} left in stock` });
    }
    if (existing) {
      await db.query('UPDATE cart_items SET qty = :qty WHERE id = :id', { id: existing.id, qty: newQty });
    } else {
      await db.query(
        `INSERT INTO cart_items (cart_id, item_type, product_id, qty, unit_price) VALUES (:cart_id, 'product', :product_id, :qty, :unit_price)`,
        { cart_id: cart.id, product_id, qty: newQty, unit_price: product.price }
      );
    }
    res.json(await cartPayload(cart));
  } catch (err) { next(err); }
});

router.put('/items/:id', async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req);
    const { qty } = req.body;
    if (!qty || qty < 1) {
      await db.query('DELETE FROM cart_items WHERE id = :id AND cart_id = :cart_id', { id: req.params.id, cart_id: cart.id });
      return res.json(await cartPayload(cart));
    }

    const [[item]] = await db.query('SELECT * FROM cart_items WHERE id = :id AND cart_id = :cart_id', { id: req.params.id, cart_id: cart.id });
    if (!item) return res.json(await cartPayload(cart));

    if (item.item_type === 'event_ticket') {
      const available = await computeTicketAvailable(item.ticket_type_id, { excludeCartId: cart.id });
      if (available != null && qty > available) {
        return res.status(400).json({ error: `Only ${available} ticket(s) left` });
      }
      const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
      await db.query('UPDATE cart_items SET qty = :qty, hold_expires_at = :hold WHERE id = :id', { id: item.id, qty, hold: holdExpiresAt });
    } else {
      await db.query('UPDATE cart_items SET qty = :qty WHERE id = :id AND cart_id = :cart_id', { id: req.params.id, qty, cart_id: cart.id });
    }
    res.json(await cartPayload(cart));
  } catch (err) { next(err); }
});

router.delete('/items/:id', async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req);
    await db.query('DELETE FROM cart_items WHERE id = :id AND cart_id = :cart_id', { id: req.params.id, cart_id: cart.id });
    res.json(await cartPayload(cart));
  } catch (err) { next(err); }
});

router.delete('/', async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req);
    await db.query('DELETE FROM cart_items WHERE cart_id = :cart_id', { cart_id: cart.id });
    res.json(await cartPayload(cart));
  } catch (err) { next(err); }
});

// Exposed so checkout.js can re-validate ticket availability at charge time
// with the exact same query, instead of duplicating it.
router.computeTicketAvailable = computeTicketAvailable;

module.exports = router;
