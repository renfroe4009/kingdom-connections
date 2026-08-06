#!/usr/bin/env node
/* =============================================================================
 * fix-programs-page-content-fidelity.js
 * Second-pass fixes found by directly re-comparing the live /programs page
 * against website-files/programs.html:
 *  - Shop with a Cop's CTA link showed a double arrow ("...Cop → →") because
 *    the stored link_text already ended in "→" and the component appended
 *    a second one (fixed in puckConfig.jsx's text-link render).
 *  - Each program's 3 reference paragraphs (2 intro sentences + 1 bold
 *    closing stat) had been squashed into one run-on paragraph with no
 *    visual break and no emphasis on the closing sentence.
 *  - The closing CTA's "100% of donations..." line rendered ABOVE the
 *    button; the reference has it as a footnote BELOW the button.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'programs'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.find(b => b.props.id === id);

  const services = byId('ServicesList-programs').props.services;

  const shop = services.find(s => s.title === 'Shop with a Cop');
  shop.description = "Each holiday season, the Ventura County Sheriff's Foundation partners with the VCSO, CHP Ventura, and local businesses to give under-resourced children a memorable shopping experience with a deputy by their side.\n\nChildren are paired one-on-one with a deputy or explorer for breakfast, photos, and a shopping trip (typically at Target in Camarillo) where they can purchase gifts for themselves and their families.";
  shop.highlight = 'Record year: 160 children served in 2019. The program continues to grow with participation from multiple VCSO stations.';

  const coppers = services.find(s => s.title === 'Coppers and Choppers');
  coppers.description = "Our annual free, family-friendly community day at the Ventura County Sheriff's Air Unit hangar at Camarillo Airport. The 10th annual event was held September 13, 2025.\n\nAttendees meet deputies from every specialized unit — K9, SWAT, Search & Rescue, Bomb/Arson, Marine Patrol, Mounted Patrol — and experience helicopter displays, static vehicle displays, food trucks, bounce houses, and hands-on activities.";
  coppers.highlight = 'This event has become one of the most beloved public safety community traditions in Ventura County. Next event: September 2026 • Free admission • All ages welcome.';

  const facility = services.find(s => s.title === 'Sgt. Ron Helus Training Facility');
  facility.description = "Named in honor of Sgt. Ron Helus, who gave his life in the 2018 Borderline Bar & Grill shooting, this live-fire training facility represents the Foundation's largest single investment in deputy safety and readiness.\n\nGroundbreaking took place in 2021. The facility provides realistic, high-stress training scenarios that prepare deputies for the complex threats they face in the field — from active shooter response to de-escalation and tactical decision-making.";
  facility.highlight = 'The Foundation also supports the K9 and Mounted Patrol training facilities (barns, arenas, and specialized training areas).';

  const cta = byId('CTABanner-programs').props;
  cta.footnoteText = cta.subtext;
  cta.footnoteColor = cta.subtextColor;
  cta.subtext = '';

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'programs' });

  console.log('Programs page content-fidelity gaps fixed.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
