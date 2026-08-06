// =============================================================================
// /api/vault — Stored payment method management (Valor Vault + Auth.net CIM)
// -----------------------------------------------------------------------------
// Passage.js flow:
//   1. GET  /client-token          → server calls /?gptoken → returns clientToken+epi
//   2. POST /save-card             → receives card_token from Passage.js iframe
//                                    → addcustomer + addpaymentprofiletoken
//                                    → stores vault_profile row
//   3. GET  /profiles              → list saved cards for a contact/org
//   4. DELETE /profiles/:id        → remove a saved card
//   5. PUT  /profiles/:id/default  → set as default for recurring invoices
//
// Auth.net CIM endpoints are stubbed with the same shape; fill in the SDK
// calls once the Accept.js flow is wired.
// =============================================================================
const router = require('express').Router();
const crypto = require('crypto');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const {
  getGateway,
  getDefaultGateway,
  valorGetClientToken,
  valorVaultAddCustomer,
  valorVaultAddPaymentProfile,
  authnetVaultCreateProfile,
  authnetVaultAddPaymentProfile,
} = require('../services/gateways');

router.use(requireAuth);

// ---------- GET /client-token ----------
// Returns a Passage.js clientToken + the epi for the requested (or default)
// Valor gateway config.  The frontend passes both to PassageJS({ clientToken, epi }).

router.get('/client-token', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const { gateway = 'valor' } = req.query;
    if (gateway !== 'valor') {
      // Auth.net uses Accept.js — no server-generated client token needed.
      return res.status(400).json({ error: 'client-token is only needed for valor (Passage.js)' });
    }
    const cfg = await getGateway('valor', null);
    if (!cfg) return res.status(400).json({ error: 'No active Valor gateway configured' });

    const clientToken = await valorGetClientToken(cfg);
    res.json({
      clientToken, epi: String(cfg.epi_id || ''), mode: cfg.mode,
      achEnabled: !!cfg.ach_enabled, achAuthorizationText: cfg.ach_authorization_text || null,
    });
  } catch (err) { next(err); }
});

// ---------- POST /intent ----------
// Creates a payment_intents row right before the payment iframe loads — only
// needed for ACH (see membership.js's /public/signup-intent for the full
// explanation). Card still goes straight through POST /save-card below.
router.post('/intent', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const d = z.object({
      contact_id: z.number().int().optional().nullable(),
      organization_id: z.number().int().optional().nullable(),
      nickname: z.string().max(100).optional().nullable(),
      is_default: z.boolean().optional(),
    }).parse(req.body);
    if (!d.contact_id && !d.organization_id) {
      return res.status(400).json({ error: 'contact_id or organization_id is required' });
    }
    const [ins] = await db.query(
      `INSERT INTO payment_intents (kind, surface, payload, contact_id, organization_id, expires_at)
       VALUES ('vault', 'add_payment_method', CAST(:payload AS JSON), :contact_id, :organization_id, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      {
        payload: JSON.stringify({ nickname: d.nickname || null, is_default: !!d.is_default }),
        contact_id: d.contact_id ?? null, organization_id: d.organization_id ?? null,
      }
    );
    res.json({ intentId: ins.insertId });
  } catch (err) { next(err); }
});

// ---------- POST /save-card ----------
// Called by the React frontend AFTER Passage.js fires its tokenReceived event
// and the parent receives the card_token via postMessage.
//
// Body:
//   gateway         'valor' | 'authnet'
//   card_token      (valor) Passage.js card_token
//   cardholder_name string
//   last4           string (optional — populated from Passage.js response if available)
//   card_brand      string (optional)
//   expiry          string  MM/YY (optional)
//   contact_id      int (optional)
//   organization_id int (optional)
//   nickname        string (optional)
//   is_default      boolean

const saveCardSchema = z.object({
  gateway:         z.enum(['valor','authnet']),
  card_token:      z.string().min(1).optional(),
  cardholder_name: z.string().max(100).optional().nullable(),
  last4:           z.string().max(4).optional().nullable(),
  card_brand:      z.string().max(32).optional().nullable(),
  expiry:          z.string().max(7).optional().nullable(),
  payment_method:  z.enum(['card','ach']).default('card'),
  contact_id:      z.number().int().optional().nullable(),
  organization_id: z.number().int().optional().nullable(),
  nickname:        z.string().max(100).optional().nullable(),
  is_default:      z.boolean().optional(),
  // Auth.net fields (for future CIM flow)
  authnet_opaque_data: z.string().optional().nullable(),
});

router.post('/save-card', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const d = saveCardSchema.parse(req.body);
    if (!d.contact_id && !d.organization_id) {
      return res.status(400).json({ error: 'contact_id or organization_id is required' });
    }

    let valor_vault_id           = null;
    let valor_payment_profile_id = null;
    let authnet_customer_profile_id  = null;
    let authnet_payment_profile_id   = null;

    if (d.gateway === 'valor') {
      if (!d.card_token) return res.status(400).json({ error: 'card_token is required for valor' });
      const cfg = await getGateway('valor', null);
      if (!cfg) return res.status(400).json({ error: 'No active Valor gateway configured' });

      // Check if this contact/org already has a Valor vault customer profile.
      const [[existing]] = await db.query(
        `SELECT valor_vault_id FROM vault_profiles
          WHERE gateway = 'valor'
            AND valor_vault_id IS NOT NULL
            AND (
              (:cid IS NOT NULL AND contact_id = :cid)
              OR (:oid IS NOT NULL AND organization_id = :oid)
            )
          LIMIT 1`,
        { cid: d.contact_id ?? null, oid: d.organization_id ?? null }
      );

      if (existing?.valor_vault_id) {
        valor_vault_id = existing.valor_vault_id;
      } else {
        // Build customer name + address from contact/org records if available.
        let customer_name = d.cardholder_name || 'Customer';
        let customer_email, customer_phone, address;

        if (d.contact_id) {
          const [[ct]] = await db.query(
            `SELECT CONCAT_WS(' ', first_name, last_name) AS name,
                    email, phone, address_line1, city, state, postal_code
               FROM contacts WHERE id = :id`,
            { id: d.contact_id }
          );
          if (ct) {
            customer_name  = ct.name  || customer_name;
            customer_email = ct.email || undefined;
            customer_phone = ct.phone || undefined;
            address = { address: ct.address_line1 || '', city: ct.city || '', state: ct.state || '', zip: ct.postal_code || '' };
          }
        } else if (d.organization_id) {
          const [[org]] = await db.query(
            `SELECT name, email, phone, address_line1, city, state, postal_code
               FROM organizations WHERE id = :id`,
            { id: d.organization_id }
          );
          if (org) {
            customer_name  = org.name  || customer_name;
            customer_email = org.email || undefined;
            customer_phone = org.phone || undefined;
            address = {
              address: org.address_line1 || '',
              city:    org.city          || '',
              state:   org.state         || '',
              zip:     org.postal_code   || '',
            };
          }
        }

        valor_vault_id = await valorVaultAddCustomer(cfg, {
          customer_name, customer_email, customer_phone, address,
        });
      }

      // Link the Passage.js card token to the vault customer.
      const profileId = await valorVaultAddPaymentProfile(cfg, {
        vault_id:       valor_vault_id,
        card_token:     d.card_token,
        cardholder_name: d.cardholder_name || undefined,
      });
      valor_payment_profile_id = profileId || null;

    } else if (d.gateway === 'authnet') {
      if (!d.authnet_opaque_data) {
        return res.status(400).json({ error: 'authnet_opaque_data is required for authnet vault' });
      }
      let opaqueData;
      try {
        opaqueData = typeof d.authnet_opaque_data === 'string'
          ? JSON.parse(d.authnet_opaque_data)
          : d.authnet_opaque_data;
      } catch (_) {
        return res.status(400).json({ error: 'authnet_opaque_data must be valid JSON {dataDescriptor, dataValue}' });
      }
      if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue) {
        return res.status(400).json({ error: 'authnet_opaque_data must include dataDescriptor and dataValue' });
      }

      const cfg = await getGateway('authnet', null);
      if (!cfg) return res.status(400).json({ error: 'No active Auth.net gateway configured' });

      // Build name/address for billTo from contact or org.
      let first_name, last_name, company, address;
      if (d.contact_id) {
        const [[ct]] = await db.query(
          `SELECT first_name, last_name, email, phone,
                  address_line1, city, state, postal_code
             FROM contacts WHERE id = :id`, { id: d.contact_id }
        );
        if (ct) {
          first_name = ct.first_name;
          last_name  = ct.last_name;
          address = { address: ct.address_line1 || '', city: ct.city || '', state: ct.state || '', zip: ct.postal_code || '' };
        }
      } else if (d.organization_id) {
        const [[org]] = await db.query(
          `SELECT name, address_line1, city, state, postal_code
             FROM organizations WHERE id = :id`, { id: d.organization_id }
        );
        if (org) {
          company = org.name;
          address = { address: org.address_line1 || '', city: org.city || '', state: org.state || '', zip: org.postal_code || '' };
        }
      }

      // Check if this contact/org already has an Auth.net customer profile.
      const [[existingAuthnet]] = await db.query(
        `SELECT authnet_customer_profile_id FROM vault_profiles
          WHERE gateway = 'authnet'
            AND authnet_customer_profile_id IS NOT NULL
            AND (
              (:cid IS NOT NULL AND contact_id = :cid)
              OR (:oid IS NOT NULL AND organization_id = :oid)
            )
          LIMIT 1`,
        { cid: d.contact_id ?? null, oid: d.organization_id ?? null }
      );

      if (existingAuthnet?.authnet_customer_profile_id) {
        // Add a new payment profile to the existing customer.
        authnet_customer_profile_id = existingAuthnet.authnet_customer_profile_id;
        authnet_payment_profile_id = await authnetVaultAddPaymentProfile(cfg, {
          customer_profile_id: authnet_customer_profile_id,
          opaque_data: opaqueData,
          first_name, last_name, company, address,
        });
      } else {
        // Create a brand-new customer profile with the payment profile attached.
        const ids = await authnetVaultCreateProfile(cfg, {
          opaque_data:          opaqueData,
          merchant_customer_id: d.contact_id || d.organization_id,
          first_name, last_name, company, address,
        });
        authnet_customer_profile_id  = ids.customerProfileId;
        authnet_payment_profile_id   = ids.customerPaymentProfileId;
      }
    }

    // If is_default, clear other defaults for this contact/org first.
    if (d.is_default) {
      await db.query(
        `UPDATE vault_profiles
            SET is_default = 0
          WHERE gateway = :gw
            AND (
              (:cid IS NOT NULL AND contact_id = :cid)
              OR (:oid IS NOT NULL AND organization_id = :oid)
            )`,
        { gw: d.gateway, cid: d.contact_id ?? null, oid: d.organization_id ?? null }
      );
    }

    const [ins] = await db.query(
      `INSERT INTO vault_profiles
         (contact_id, organization_id, gateway,
          valor_vault_id, valor_payment_profile_id, card_token,
          authnet_customer_profile_id, authnet_payment_profile_id,
          last4, card_brand, cardholder_name, expiry, payment_method,
          nickname, is_default, created_by)
       VALUES
         (:contact_id, :organization_id, :gateway,
          :valor_vault_id, :valor_payment_profile_id, :card_token,
          :authnet_customer_profile_id, :authnet_payment_profile_id,
          :last4, :card_brand, :cardholder_name, :expiry, :payment_method,
          :nickname, :is_default, :created_by)`,
      {
        contact_id:      d.contact_id      ?? null,
        organization_id: d.organization_id ?? null,
        gateway:         d.gateway,
        valor_vault_id,
        valor_payment_profile_id,
        card_token:      d.card_token      ?? null,
        authnet_customer_profile_id,
        authnet_payment_profile_id,
        last4:           d.last4           ?? null,
        card_brand:      d.card_brand      ?? null,
        cardholder_name: d.cardholder_name ?? null,
        expiry:          d.expiry          ?? null,
        payment_method:  d.payment_method,
        nickname:        d.nickname        ?? null,
        is_default:      d.is_default ? 1 : 0,
        created_by:      req.user.id,
      }
    );

    await logActivity({
      userId: req.user.id,
      entityType: d.contact_id ? 'contact' : 'organization',
      entityId: d.contact_id || d.organization_id,
      action: 'vault_card_saved',
      description: `Saved ${d.gateway} payment method ****${d.last4 || '????'} (${d.card_brand || 'card'})`,
    });

    res.status(201).json({
      id: ins.insertId,
      gateway: d.gateway,
      valor_vault_id,
      valor_payment_profile_id,
      last4: d.last4,
      card_brand: d.card_brand,
      cardholder_name: d.cardholder_name,
    });
  } catch (err) { next(err); }
});

// ---------- GET /profiles ----------
// List saved payment methods for a contact or org.

router.get('/profiles', requirePermission('payments.read'), async (req, res, next) => {
  try {
    let { contact_id, organization_id } = req.query;

    // Portal users must never be able to pull another customer's saved cards
    // by passing an arbitrary contact_id/organization_id — force their own
    // linked contact/org regardless of what the query string says.
    if (req.user.roles?.includes('portal')) {
      const [[row]] = await db.query(
        `SELECT u.contact_id, c.organization_id
           FROM users u LEFT JOIN contacts c ON c.id = u.contact_id
          WHERE u.id = :id`,
        { id: req.user.id }
      );
      contact_id      = row?.contact_id      || null;
      organization_id = row?.organization_id || null;
    }

    if (!contact_id && !organization_id) {
      return res.status(400).json({ error: 'contact_id or organization_id is required' });
    }
    const where = []; const params = {};
    if (contact_id)      { where.push('contact_id = :cid');      params.cid = Number(contact_id); }
    if (organization_id) { where.push('organization_id = :oid'); params.oid = Number(organization_id); }

    const [rows] = await db.query(
      `SELECT id, gateway, last4, card_brand, cardholder_name, expiry,
              payment_method, nickname, is_default, created_at,
              -- Never expose raw card_token or vault IDs to the client except
              -- the non-sensitive display IDs.
              valor_vault_id, valor_payment_profile_id,
              authnet_customer_profile_id, authnet_payment_profile_id
         FROM vault_profiles
        WHERE (${where.join(' OR ')})
          AND deleted_at IS NULL
        ORDER BY is_default DESC, created_at DESC`,
      params
    );
    res.json({ profiles: rows });
  } catch (err) { next(err); }
});

// ---------- PUT /profiles/:id/default ----------

router.put('/profiles/:id/default', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[profile]] = await db.query(
      'SELECT * FROM vault_profiles WHERE id = :id', { id });
    if (!profile) return res.status(404).json({ error: 'Not found' });

    // Clear existing defaults for same contact/org+gateway combo.
    await db.query(
      `UPDATE vault_profiles
          SET is_default = 0
        WHERE gateway = :gw
          AND (
            (:cid IS NOT NULL AND contact_id = :cid)
            OR (:oid IS NOT NULL AND organization_id = :oid)
          )`,
      { gw: profile.gateway, cid: profile.contact_id ?? null, oid: profile.organization_id ?? null }
    );
    await db.query('UPDATE vault_profiles SET is_default = 1 WHERE id = :id', { id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- DELETE /profiles/:id ----------

router.delete('/profiles/:id', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[profile]] = await db.query(
      'SELECT id, gateway, last4, card_brand FROM vault_profiles WHERE id = :id AND deleted_at IS NULL', { id });
    if (!profile) return res.status(404).json({ error: 'Not found' });

    await db.query('UPDATE vault_profiles SET deleted_at = NOW() WHERE id = :id', { id });

    await logActivity({
      userId: req.user.id,
      entityType: 'vault_profile',
      entityId: id,
      action: 'vault_card_removed',
      description: `Removed ${profile.gateway} payment method ****${profile.last4 || '????'}`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- POST /charge-invoice ----------
// Charges a stored vault profile to pay an invoice balance (admin path).
// Mirrors portal /invoices/:id/pay-saved — same gateway logic, admin-scoped.

const {
  valorVaultCharge,
  mapValorVaultChargeResponse,
  authnetVaultCharge,
  mapAuthnetVaultChargeResponse,
  computeProcessingFee,
} = require('../services/gateways');

router.post('/charge-invoice', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const { invoice_id, vault_profile_id } = z.object({
      invoice_id:       z.number().int(),
      vault_profile_id: z.number().int(),
    }).parse(req.body);

    const [[inv]] = await db.query(
      `SELECT i.*, c.email AS contact_email,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
         FROM invoices i
         LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE i.id = :id AND i.status NOT IN ('void')`,
      { id: invoice_id }
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (Number(inv.balance_due) <= 0) return res.status(400).json({ error: 'Invoice balance is zero' });

    const [[profile]] = await db.query(
      'SELECT * FROM vault_profiles WHERE id = :id AND deleted_at IS NULL',
      { id: vault_profile_id }
    );
    if (!profile) return res.status(404).json({ error: 'Payment method not found' });

    const baseAmount = Number(inv.balance_due);
    const receiptToken = crypto.randomBytes(32).toString('hex');
    let paymentId, txnId, chargeStatus, chargedAmount;

    if (profile.gateway === 'valor') {
      if (!profile.card_token) return res.status(400).json({ error: 'Valor card token missing on this payment method' });
      const cfg = await getGateway('valor', null);
      if (!cfg) return res.status(500).json({ error: 'Valor gateway not configured' });

      // Same b2b_only-gated surcharge every other charge path applies —
      // card-network rules restrict surcharging individual consumers.
      const isB2B = Boolean(inv.organization_id);
      const feeAllowed = !cfg.b2b_only || isB2B;
      const fee = feeAllowed ? computeProcessingFee({ cfg, baseAmount }) : null;
      const amount = Math.round((baseAmount + (fee?.amount || 0)) * 100) / 100;
      chargedAmount = amount;

      const chargeJson = await valorVaultCharge(cfg, {
        card_token: profile.card_token, amount,
        invoicenumber: inv.invoice_number, cardholdername: profile.cardholder_name || undefined,
        email: inv.contact_email || undefined, surcharge_amount: fee?.amount || 0,
      });
      const mapped = mapValorVaultChargeResponse(chargeJson);
      const captured = mapped?.status === 'captured';

      if (fee?.amount > 0) {
        const [[{ lineCount }]] = await db.query(
          'SELECT COUNT(*) AS lineCount FROM invoice_line_items WHERE invoice_id = :id', { id: invoice_id });
        await db.query(
          `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
           VALUES (:invoice_id, :desc, 1, :amount, :amount, :sort_order)`,
          { invoice_id: invoice_id, desc: fee.label, amount: fee.amount, sort_order: lineCount }
        );
        await db.query(
          `UPDATE invoices SET total = total + :fee, balance_due = balance_due + :fee WHERE id = :id`,
          { fee: fee.amount, id: invoice_id }
        );
        inv.total = Number(inv.total) + fee.amount;
      }

      const [pIns] = await db.query(
        `INSERT INTO payments
           (invoice_id, gateway, method, amount, currency, status,
            fee_amount, fee_label,
            external_txn_id, external_auth_code,
            card_last4, card_brand, card_expiry, card_holder_name,
            processor_message, processor_code,
            processor_response, received_at, receipt_token)
         VALUES (:iid,'valor','card',:amount,:currency,:status,:fee,:flab,:txnId,:auth,
                 :last4,:brand,:exp,:holder,:pmsg,:pcode,
                 CAST(:raw AS JSON),NOW(),:rtok)`,
        {
          iid: invoice_id, amount, currency: inv.currency || 'USD',
          status: mapped?.status || 'failed', fee: fee?.amount || null, flab: fee?.label || null,
          txnId: mapped?.txnId || null, auth: mapped?.auth || null,
          last4: mapped?.last4 || profile.last4 || null, brand: mapped?.brand || profile.card_brand || null,
          exp: mapped?.exp || profile.expiry || null, holder: mapped?.holder || profile.cardholder_name || null,
          pmsg: mapped?.pmsg || null, pcode: mapped?.pcode || null,
          raw: JSON.stringify(chargeJson), rtok: receiptToken,
        }
      );
      paymentId = pIns.insertId; txnId = mapped?.txnId; chargeStatus = mapped?.status || 'failed';
      if (!captured) return res.status(402).json({ ok: false, error: mapped?.pmsg || 'Card declined', status: chargeStatus });

    } else if (profile.gateway === 'authnet') {
      if (!profile.authnet_customer_profile_id || !profile.authnet_payment_profile_id) {
        return res.status(400).json({ error: 'Auth.net profile IDs missing on this payment method' });
      }
      const cfg = await getGateway('authnet', null);
      if (!cfg) return res.status(500).json({ error: 'Auth.net gateway not configured' });

      const isB2B = Boolean(inv.organization_id);
      const feeAllowed = !cfg.b2b_only || isB2B;
      const fee = feeAllowed ? computeProcessingFee({ cfg, baseAmount }) : null;
      const amount = Math.round((baseAmount + (fee?.amount || 0)) * 100) / 100;
      chargedAmount = amount;

      const chargeJson = await authnetVaultCharge(cfg, {
        customer_profile_id: profile.authnet_customer_profile_id,
        payment_profile_id:  profile.authnet_payment_profile_id,
        amount, invoice_number: inv.invoice_number,
        description: `Invoice ${inv.invoice_number}`, surcharge_amount: fee?.amount || 0,
      });
      const mapped = mapAuthnetVaultChargeResponse(chargeJson);
      const captured = mapped?.approved === true;

      if (fee?.amount > 0) {
        const [[{ lineCount }]] = await db.query(
          'SELECT COUNT(*) AS lineCount FROM invoice_line_items WHERE invoice_id = :id', { id: invoice_id });
        await db.query(
          `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
           VALUES (:invoice_id, :desc, 1, :amount, :amount, :sort_order)`,
          { invoice_id: invoice_id, desc: fee.label, amount: fee.amount, sort_order: lineCount }
        );
        await db.query(
          `UPDATE invoices SET total = total + :fee, balance_due = balance_due + :fee WHERE id = :id`,
          { fee: fee.amount, id: invoice_id }
        );
        inv.total = Number(inv.total) + fee.amount;
      }

      const [pIns] = await db.query(
        `INSERT INTO payments
           (invoice_id, gateway, method, amount, currency, status,
            fee_amount, fee_label,
            external_txn_id, external_auth_code,
            card_last4, card_brand, card_expiry, card_holder_name,
            processor_message, processor_code,
            avs_result, cvv_result,
            processor_response, received_at, receipt_token)
         VALUES (:iid,'authnet','card',:amount,:currency,:status,:fee,:flab,:txnId,:auth,
                 :last4,:brand,:exp,:holder,:pmsg,:pcode,:avs,:cvv,
                 CAST(:raw AS JSON),NOW(),:rtok)`,
        {
          iid: invoice_id, amount, currency: inv.currency || 'USD',
          status: captured ? 'captured' : 'failed',
          fee: fee?.amount || null, flab: fee?.label || null,
          txnId: mapped?.external_txn_id || null, auth: mapped?.external_auth_code || null,
          last4: mapped?.card_last4 || profile.last4 || null, brand: mapped?.card_brand || profile.card_brand || null,
          exp: profile.expiry || null, holder: profile.cardholder_name || null,
          pmsg: mapped?.processor_message || null, pcode: mapped?.processor_code || null,
          avs: mapped?.avs_result || null, cvv: mapped?.cvv_result || null,
          raw: JSON.stringify(chargeJson), rtok: receiptToken,
        }
      );
      paymentId = pIns.insertId; txnId = mapped?.external_txn_id; chargeStatus = captured ? 'captured' : 'failed';
      if (!captured) return res.status(402).json({ ok: false, error: mapped?.decline_reason || mapped?.processor_message || 'Card declined', status: chargeStatus });

    } else {
      return res.status(400).json({ error: `Unknown gateway: ${profile.gateway}` });
    }

    // Update invoice balance / status
    const [[updated]] = await db.query(
      'SELECT SUM(amount) AS paid FROM payments WHERE invoice_id = :id AND status = "captured"',
      { id: invoice_id }
    );
    const totalPaid   = Number(updated?.paid || 0);
    const newBalance  = Math.max(0, Math.round((Number(inv.total) - totalPaid) * 100) / 100);
    const newStatus   = newBalance <= 0.005 ? 'paid' : 'partial';
    await db.query(
      `UPDATE invoices SET amount_paid = :paid, balance_due = :bal, status = :status
          ${newStatus === 'paid' ? ', paid_at = NOW()' : ''} WHERE id = :id`,
      { paid: totalPaid, bal: newBalance, status: newStatus, id: invoice_id }
    );

    await logActivity({
      userId: req.user.id, entityType: 'invoice', entityId: invoice_id,
      action: 'payment_captured',
      description: `Charged saved ${profile.gateway} card ****${profile.last4 || '????'} — ${chargedAmount.toFixed(2)} — txn ${txnId || 'n/a'}`,
    });

    res.json({ ok: true, paymentId, txnId, status: chargeStatus, balance_due: newBalance });
  } catch (err) { next(err); }
});

module.exports = router;
