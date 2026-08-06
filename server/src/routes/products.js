// =============================================================================
// /api/products — storefront catalog (public reads) + admin management
// Categories live under /api/products/categories/*
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Categories ───────────────────────────────────────────────────────────────

router.get('/categories', async (req, res, next) => {
  try {
    const activeOnly = !req.query.all;
    const [rows] = await db.query(
      `SELECT * FROM product_categories ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY sort_order, name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

const categorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional().nullable(),
  parent_id: z.union([z.number(), z.null()]).optional(),
  sort_order: z.number().optional(),
  is_active: z.boolean().optional(),
});

router.post('/categories', requireAuth, requirePermission('products.write'), async (req, res, next) => {
  try {
    const d = categorySchema.parse(req.body);
    const slug = slugify(d.slug || d.name);
    const [ins] = await db.query(
      `INSERT INTO product_categories (name, slug, description, parent_id, sort_order, is_active)
       VALUES (:name, :slug, :description, :parent_id, :sort_order, :is_active)`,
      { name: d.name, slug, description: d.description || null, parent_id: d.parent_id || null,
        sort_order: d.sort_order || 0, is_active: d.is_active === false ? 0 : 1 }
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/categories/:id', requireAuth, requirePermission('products.write'), async (req, res, next) => {
  try {
    const d = categorySchema.parse(req.body);
    const slug = slugify(d.slug || d.name);
    await db.query(
      `UPDATE product_categories SET name=:name, slug=:slug, description=:description,
       parent_id=:parent_id, sort_order=:sort_order, is_active=:is_active WHERE id=:id`,
      { id: req.params.id, name: d.name, slug, description: d.description || null,
        parent_id: d.parent_id || null, sort_order: d.sort_order || 0, is_active: d.is_active === false ? 0 : 1 }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/categories/:id', requireAuth, requirePermission('products.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM product_categories WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Products — admin (must come before /:slug) ─────────────────────────────

router.get('/admin', requireAuth, requirePermission('products.read'), async (req, res, next) => {
  try {
    const { search = '', category_id = '' } = req.query;
    let sql = `SELECT p.*, c.name AS category_name,
                 (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1) AS image_url
               FROM products p
               LEFT JOIN product_categories c ON c.id = p.category_id
               WHERE 1=1`;
    const params = {};
    if (search) { sql += ' AND (p.name LIKE :search OR p.sku LIKE :search)'; params.search = `%${search}%`; }
    if (category_id) { sql += ' AND p.category_id = :category_id'; params.category_id = category_id; }
    sql += ' ORDER BY p.sort_order, p.name';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/admin/:id', requireAuth, requirePermission('products.read'), async (req, res, next) => {
  try {
    const [[product]] = await db.query('SELECT * FROM products WHERE id = :id', { id: req.params.id });
    if (!product) return res.status(404).json({ error: 'Not found' });
    const [images] = await db.query(
      'SELECT * FROM product_images WHERE product_id = :id ORDER BY is_primary DESC, sort_order', { id: req.params.id }
    );
    res.json({ ...product, images });
  } catch (err) { next(err); }
});

const productSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional().nullable(),
  short_desc: z.string().optional().nullable(),
  category_id: z.union([z.number(), z.null()]).optional(),
  price: z.number().min(0),
  compare_price: z.union([z.number(), z.null()]).optional(),
  cost: z.union([z.number(), z.null()]).optional(),
  weight_oz: z.union([z.number(), z.null()]).optional(),
  taxable: z.boolean().optional(),
  track_inventory: z.boolean().optional(),
  stock_qty: z.number().optional(),
  is_active: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  sort_order: z.number().optional(),
  meta_title: z.string().optional().nullable(),
  meta_desc: z.string().optional().nullable(),
});

router.post('/', requireAuth, requirePermission('products.write'), async (req, res, next) => {
  try {
    const d = productSchema.parse(req.body);
    const slug = slugify(d.slug || d.name);
    const [ins] = await db.query(
      `INSERT INTO products (sku, name, slug, description, short_desc, category_id, price, compare_price,
        cost, weight_oz, taxable, track_inventory, stock_qty, is_active, is_featured, sort_order, meta_title, meta_desc)
       VALUES (:sku, :name, :slug, :description, :short_desc, :category_id, :price, :compare_price,
        :cost, :weight_oz, :taxable, :track_inventory, :stock_qty, :is_active, :is_featured, :sort_order, :meta_title, :meta_desc)`,
      {
        sku: d.sku, name: d.name, slug, description: d.description || null, short_desc: d.short_desc || null,
        category_id: d.category_id || null, price: d.price, compare_price: d.compare_price ?? null,
        cost: d.cost ?? null, weight_oz: d.weight_oz ?? null, taxable: d.taxable === false ? 0 : 1,
        track_inventory: d.track_inventory ? 1 : 0, stock_qty: d.stock_qty || 0,
        is_active: d.is_active === false ? 0 : 1, is_featured: d.is_featured ? 1 : 0,
        sort_order: d.sort_order || 0, meta_title: d.meta_title || null, meta_desc: d.meta_desc || null,
      }
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, requirePermission('products.write'), async (req, res, next) => {
  try {
    const d = productSchema.parse(req.body);
    const slug = slugify(d.slug || d.name);
    await db.query(
      `UPDATE products SET sku=:sku, name=:name, slug=:slug, description=:description, short_desc=:short_desc,
        category_id=:category_id, price=:price, compare_price=:compare_price, cost=:cost, weight_oz=:weight_oz,
        taxable=:taxable, track_inventory=:track_inventory, stock_qty=:stock_qty, is_active=:is_active,
        is_featured=:is_featured, sort_order=:sort_order, meta_title=:meta_title, meta_desc=:meta_desc
       WHERE id=:id`,
      {
        id: req.params.id, sku: d.sku, name: d.name, slug, description: d.description || null,
        short_desc: d.short_desc || null, category_id: d.category_id || null, price: d.price,
        compare_price: d.compare_price ?? null, cost: d.cost ?? null, weight_oz: d.weight_oz ?? null,
        taxable: d.taxable === false ? 0 : 1, track_inventory: d.track_inventory ? 1 : 0,
        stock_qty: d.stock_qty || 0, is_active: d.is_active === false ? 0 : 1,
        is_featured: d.is_featured ? 1 : 0, sort_order: d.sort_order || 0,
        meta_title: d.meta_title || null, meta_desc: d.meta_desc || null,
      }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Soft delete — preserves order history (order_items.product_id survives via ON DELETE SET NULL anyway).
router.delete('/:id', requireAuth, requirePermission('products.write'), async (req, res, next) => {
  try {
    await db.query('UPDATE products SET is_active = 0 WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Product images ───────────────────────────────────────────────────────────
// Images come from the shared media library (MediaPickerModal) — the client
// posts the file_url it already has, no separate upload pipeline needed here.

router.post('/:id/images', requireAuth, requirePermission('products.write'), async (req, res, next) => {
  try {
    const { url, alt_text = '', sort_order = 0 } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM product_images WHERE product_id = :id', { id: req.params.id });
    const [ins] = await db.query(
      'INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary) VALUES (:pid, :url, :alt_text, :sort_order, :is_primary)',
      { pid: req.params.id, url, alt_text, sort_order, is_primary: cnt === 0 ? 1 : 0 }
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.delete('/:id/images/:imgId', requireAuth, requirePermission('products.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM product_images WHERE id = :imgId AND product_id = :id', req.params);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/:id/images/:imgId/primary', requireAuth, requirePermission('products.write'), async (req, res, next) => {
  try {
    await db.query('UPDATE product_images SET is_primary = 0 WHERE product_id = :id', { id: req.params.id });
    await db.query('UPDATE product_images SET is_primary = 1 WHERE id = :imgId AND product_id = :id', req.params);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Public storefront ────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { category_id = '', featured = '' } = req.query;
    let sql = `SELECT p.id, p.sku, p.name, p.slug, p.short_desc, p.price, p.compare_price, p.category_id,
                 (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1) AS image_url
               FROM products p WHERE p.is_active = 1`;
    const params = {};
    if (category_id) { sql += ' AND p.category_id = :category_id'; params.category_id = category_id; }
    if (featured) sql += ' AND p.is_featured = 1';
    sql += ' ORDER BY p.sort_order, p.name';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const [[product]] = await db.query(
      'SELECT * FROM products WHERE slug = :slug AND is_active = 1', { slug: req.params.slug }
    );
    if (!product) return res.status(404).json({ error: 'Not found' });
    const [images] = await db.query(
      'SELECT * FROM product_images WHERE product_id = :id ORDER BY is_primary DESC, sort_order', { id: product.id }
    );
    res.json({ ...product, images });
  } catch (err) { next(err); }
});

module.exports = router;
