#!/usr/bin/env node
/* =============================================================================
 * seed-shop-products.js
 * Pulls the 6 merchandise items from website-files/shop.html into real
 * `products` rows, using the stock photos already in the media library
 * (uploaded by seed-vcsf-website.js) as product images.
 *
 * Idempotent — matched/updated by SKU on re-run.
 * Run: cd server && node scripts/seed-shop-products.js
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const PRODUCTS = [
  { sku: 'VCSF-SIGN-01',  name: 'Backing the Badge Yard Sign', price: 10, image: '6.jpg',
    short_desc: 'Show your support in your front yard', taxable: 1 },
  { sku: 'VCSF-POLO-01',  name: 'VCSF Embroidered Polo', price: 45, image: '8.jpg',
    short_desc: 'Navy with gold logo — Sizes S–3XL', taxable: 1 },
  { sku: 'VCSF-CAP-01',   name: 'VCSF Embroidered Cap', price: 22, image: '8.jpg',
    short_desc: 'Navy with gold logo — Adjustable', taxable: 1 },
  { sku: 'VCSF-COIN-01',  name: 'VCSF Challenge Coin', price: 15, image: '8.jpg',
    short_desc: 'Limited edition — Collectible', taxable: 1 },
  { sku: 'VCSF-HOOD-01',  name: 'VCSF Heavyweight Hoodie', price: 58, image: '8.jpg',
    short_desc: 'Premium fleece — Sizes S–3XL', taxable: 1 },
  { sku: 'VCSF-DECAL-01', name: 'Window Decal Pack (3)', price: 12, image: '6.jpg',
    short_desc: 'For car, home, or office', taxable: 1 },
];

async function main() {
  const [[cat]] = await db.query("SELECT id FROM product_categories WHERE slug = 'merchandise'");
  let categoryId = cat?.id;
  if (!categoryId) {
    const [r] = await db.query(
      "INSERT INTO product_categories (name, slug, description, is_active) VALUES ('Merchandise', 'merchandise', 'Official VCSF merchandise', 1)"
    );
    categoryId = r.insertId;
    console.log(`✓ created category "Merchandise" (id ${categoryId})`);
  }

  const images = {};
  const [rows] = await db.query("SELECT original_name, file_url FROM media_files WHERE original_name IN ('6.jpg','8.jpg')");
  for (const r of rows) images[r.original_name] = r.file_url;
  if (!images['6.jpg'] || !images['8.jpg']) {
    throw new Error('Expected media library images 6.jpg / 8.jpg not found — run seed-vcsf-website.js first.');
  }

  for (const p of PRODUCTS) {
    const slug = slugify(p.name);
    const [[existing]] = await db.query('SELECT id FROM products WHERE sku = :sku', { sku: p.sku });
    let productId;
    if (existing) {
      productId = existing.id;
      await db.query(
        `UPDATE products SET name=:name, slug=:slug, short_desc=:short_desc, category_id=:category_id,
          price=:price, taxable=:taxable, is_active=1 WHERE id=:id`,
        { id: productId, name: p.name, slug, short_desc: p.short_desc, category_id: categoryId, price: p.price, taxable: p.taxable }
      );
      console.log(`= updated "${p.name}"`);
    } else {
      const [ins] = await db.query(
        `INSERT INTO products (sku, name, slug, short_desc, category_id, price, taxable, track_inventory, stock_qty, is_active)
         VALUES (:sku, :name, :slug, :short_desc, :category_id, :price, :taxable, 0, 0, 1)`,
        { sku: p.sku, name: p.name, slug, short_desc: p.short_desc, category_id: categoryId, price: p.price, taxable: p.taxable }
      );
      productId = ins.insertId;
      console.log(`+ created "${p.name}" (id ${productId})`);
    }

    const [[img]] = await db.query('SELECT id FROM product_images WHERE product_id = :id', { id: productId });
    if (!img) {
      await db.query(
        'INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary) VALUES (:pid, :url, :alt, 0, 1)',
        { pid: productId, url: images[p.image], alt: p.name }
      );
      console.log(`  + image attached (${p.image})`);
    }
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
