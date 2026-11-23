// =============================================================================
// Course completion certificates — same pdfkit/data-loader pattern already
// established in services/receipts.js (the only other PDF generator in this
// app), just a simpler landscape layout since there's no line-item table.
// =============================================================================
const PDFDocument = require('pdfkit');
const { db } = require('../db');
const { resolveBusinessLogoUrl } = require('./templates');
const { logoUrlToBuffer } = require('./receipts');
const { NEUTRAL, withFallback } = require('./brandColors');

// Mirrors receipts.js's resolveBusinessBranding() — not exported from that
// file, so reproduced here rather than widening that file's export surface
// for one more caller.
async function resolveBusinessBranding() {
  const [[biz]] = await db.query(
    `SELECT business_name, logo_web_url, logo_web_storage_key, logo_web_storage_driver,
            primary_color, secondary_color
       FROM business_settings WHERE id = 1`
  );
  let logoUrl = '';
  try { if (biz) logoUrl = await resolveBusinessLogoUrl(biz); } catch (_e) { /* logo optional */ }
  const logoBuffer = await logoUrlToBuffer(logoUrl);
  return {
    name: biz?.business_name || '',
    logoBuffer,
    primaryColor: withFallback(biz?.primary_color, NEUTRAL.primary),
    secondaryColor: withFallback(biz?.secondary_color, NEUTRAL.secondary),
  };
}

async function nextCertificateNumber() {
  const year = new Date().getUTCFullYear();
  const prefix = `CERT-${year}-`;
  const [rows] = await db.query(
    `SELECT certificate_number FROM lms_certificates WHERE certificate_number LIKE :p ORDER BY id DESC LIMIT 1`,
    { p: `${prefix}%` }
  );
  const last = rows[0]?.certificate_number;
  const seq = last ? Number(last.split('-').pop()) + 1 : 1;
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// Issues (idempotently) a certificate for one contact's completed course.
// Safe to call every time a lesson completes — the unique (course_id,
// contact_id) key means a second call for an already-100%-complete course
// is a no-op, not a duplicate.
async function issueCertificateIfComplete({ courseId, contactId }) {
  const [[existing]] = await db.query(
    'SELECT id FROM lms_certificates WHERE course_id = :cid AND contact_id = :uid',
    { cid: courseId, uid: contactId }
  );
  if (existing) return existing.id;

  const number = await nextCertificateNumber();
  try {
    const [ins] = await db.query(
      `INSERT INTO lms_certificates (course_id, contact_id, certificate_number) VALUES (:cid, :uid, :num)`,
      { cid: courseId, uid: contactId, num: number }
    );
    // Fire-and-forget — a genuinely new certificate (not the idempotent
    // early-return above) is the one moment worth telling anyone about.
    (async () => {
      const [[course]] = await db.query('SELECT title FROM lms_courses WHERE id = :id', { id: courseId });
      const { notifyLmsEvent } = require('./constituents');
      const { notifyLmsChange } = require('./ppWebhooks');
      await notifyLmsEvent('certificate.issued', contactId, { courseName: course?.title });
      await notifyLmsChange('certificate.issued', contactId, {
        course_title: course?.title, certificate_number: number,
      });
    })().catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[lmsCertificates] certificate.issued notify failed for contact #${contactId}:`, e.message);
    });
    return ins.insertId;
  } catch (e) {
    // Unique-key race (two completion events landing at once) — the row
    // now exists either way, so just look it up rather than fail the caller.
    if (e.code === 'ER_DUP_ENTRY') {
      const [[row]] = await db.query(
        'SELECT id FROM lms_certificates WHERE course_id = :cid AND contact_id = :uid',
        { cid: courseId, uid: contactId }
      );
      return row?.id || null;
    }
    throw e;
  }
}

async function renderCertificatePdf({ contactName, courseTitle, certificateNumber, issuedAt, company }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 56 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand = company.primaryColor;
    const ink = '#212529';
    const muted = '#6c757d';
    const { width, height } = doc.page;

    doc.save()
      .lineWidth(3).strokeColor(brand)
      .rect(28, 28, width - 56, height - 56).stroke()
      .restore();

    let y = 60;
    if (company.logoBuffer) {
      try {
        // width-only sizing lets pdfkit keep the source aspect ratio, so a
        // roughly-square logo can come out as tall as it is wide — advance
        // past the full box, not just half of it, or the title below
        // overlaps it (a real bug caught in local verification).
        const logoBoxSize = 90;
        doc.image(company.logoBuffer, width / 2 - logoBoxSize / 2, y, { fit: [logoBoxSize, logoBoxSize] });
        y += logoBoxSize + 16;
      } catch (_e) { /* corrupt/unsupported image — skip */ }
    }

    doc.fillColor(muted).fontSize(14).font('Helvetica').text('CERTIFICATE OF COMPLETION', 0, y, { align: 'center' });
    y += 36;
    doc.fillColor(brand).fontSize(30).font('Helvetica-Bold').text(company.name || 'Kingdom Connections', 0, y, { align: 'center' });
    y += 56;

    doc.fillColor(muted).fontSize(13).font('Helvetica').text('This certifies that', 0, y, { align: 'center' });
    y += 28;
    doc.fillColor(ink).fontSize(26).font('Helvetica-Bold').text(contactName, 0, y, { align: 'center' });
    y += 42;
    doc.fillColor(muted).fontSize(13).font('Helvetica').text('has successfully completed', 0, y, { align: 'center' });
    y += 28;
    doc.fillColor(ink).fontSize(22).font('Helvetica-Bold').text(courseTitle, 0, y, { align: 'center', width });
    y += 50;

    doc.fillColor(muted).fontSize(11).font('Helvetica').text(
      `Issued ${new Date(issuedAt).toLocaleDateString()} — Certificate No. ${certificateNumber}`,
      0, height - 90, { align: 'center' }
    );

    doc.end();
  });
}

module.exports = { resolveBusinessBranding, issueCertificateIfComplete, renderCertificatePdf };
