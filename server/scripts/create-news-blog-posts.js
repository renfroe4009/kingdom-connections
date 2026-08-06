#!/usr/bin/env node
/* =============================================================================
 * create-news-blog-posts.js
 * The News page's 4 CardGrid items ("10th Annual Coppers and Choppers...",
 * "Shop with a Cop 2025...", "Sgt. Ron Helus Training Facility...",
 * "Grossman Scholarship...") had no real detail page to link to — the
 * reference website-files/news/*.html static mockups aren't live routes.
 * This creates 4 real published blog_posts (adapted from those reference
 * articles, with real media_files image URLs) so "Read More" can link to
 * an actual /blog/:slug page rendered by BlogPostPage.jsx.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

async function main() {
  const [rows] = await db.query("SELECT original_name, file_url FROM media_files WHERE original_name REGEXP '^[0-9]+\\\\.jpg$'");
  const u = {};
  for (const r of rows) u[r.original_name] = r.file_url;

  const posts = [
    {
      slug: 'coppers-and-choppers-2025',
      title: '10th Annual Coppers and Choppers Draws Record Crowd',
      excerpt: 'Hundreds of families gathered at the Camarillo Airport Air Unit hangar for helicopter displays, K9 demonstrations, SWAT vehicles, and community connection.',
      og_image: u['3.jpg'],
      published_at: '2025-09-13 00:00:00',
      body_html: `
        <p>The 10th anniversary of Coppers and Choppers welcomed hundreds of families to the Ventura County Sheriff's Air Unit at Camarillo Airport on September 13, 2025. What began a decade ago as a way to open the hangar doors to the public has become one of Ventura County's most beloved free public safety days.</p>
        <p>Attendees explored walk-around tours of Copter 5 (Firehawk), watched K9 demonstrations, and got a close look at SWAT and bomb squad vehicles. Search &amp; Rescue teams shared gear and stories, while food trucks and children's activities kept the day family-friendly from open to close.</p>
        <figure><img src="${u['1.jpg']}" alt="Community members and public safety personnel at a VCSF event"><figcaption>Community partnerships make free events like Coppers and Choppers possible every year.</figcaption></figure>
        <h2>Why this day matters</h2>
        <p>Coppers and Choppers puts deputies and residents side by side in a positive setting &mdash; no emergency, no traffic stop, just conversation, curiosity, and trust-building. Parents often tell us their children leave wanting to know more about public safety careers; deputies leave recharged by the support of the community they serve.</p>
        <blockquote>&ldquo;This event remains completely free thanks to the generous support of sponsors and the Foundation.&rdquo;</blockquote>
        <p>Specialized units on display typically include K9, SWAT, Search &amp; Rescue, Bomb/Arson, Marine Patrol, and Mounted Patrol, alongside Air Unit aircraft and static vehicle displays.</p>
        <figure><img src="${u['5.jpg']}" alt="Families engaging with Ventura County Sheriff's Office units"><figcaption>Hands-on displays help residents meet the people behind the badge.</figcaption></figure>
        <h2>Looking ahead</h2>
        <p>Planning is already underway for the next Coppers and Choppers in September 2026. Admission will again be free and open to all ages. Local businesses interested in sponsorship can reach the Foundation at admin@vcsheriffsfoundation.org or through our <a href="/support#sponsor">Support</a> page.</p>
      `.trim(),
    },
    {
      slug: 'shop-with-a-cop-2025',
      title: 'Shop with a Cop 2025 Brings Joy to Local Children',
      excerpt: 'Deputies from multiple stations, Explorers, and volunteers paired with children for holiday shopping at Target.',
      og_image: u['2.jpg'],
      published_at: '2025-12-01 00:00:00',
      body_html: `
        <p>Each holiday season, the Ventura County Sheriff's Foundation partners with the Ventura County Sheriff's Office, CHP Ventura, and local businesses to give under-resourced children a memorable shopping experience with a deputy by their side.</p>
        <p>In 2025, deputies and Explorers from stations across the county spent the day with children facing financial hardship. Each child received breakfast, a photo with their deputy, and the chance to purchase gifts for themselves and their families &mdash; typically at Target in Camarillo.</p>
        <figure><img src="${u['7.jpg']}" alt="Community partnership and service with Ventura County Sheriff's Foundation"><figcaption>One-on-one time between deputies and youth is the heart of Shop with a Cop.</figcaption></figure>
        <h2>Record impact, lasting trust</h2>
        <p>A single Shop with a Cop cycle has supported as many as 160 children. The program continues to grow with participation from multiple VCSO stations. Beyond gifts and meals, the day creates lasting positive memories and humanizes law enforcement for families who may rarely see deputies outside of difficult moments.</p>
        <blockquote>&ldquo;Breakfast, photos, and one-on-one time create lasting positive memories between law enforcement and youth.&rdquo;</blockquote>
        <p>The program is supported entirely by donations and sponsors such as Target and local restaurants. Businesses and individuals can designate gifts specifically to Shop with a Cop when they give through the Foundation.</p>
        <figure><img src="${u['6.jpg']}" alt="Showing support for local law enforcement in the community"><figcaption>Community sponsors make shopping trips and meals possible for every child.</figcaption></figure>
        <h2>How you can help</h2>
        <p>Designate your next gift to Shop with a Cop on our <a href="/support#donate">donation page</a>, or contact us about event sponsorship. Every contribution goes directly to children and the deputies who serve them.</p>
      `.trim(),
    },
    {
      slug: 'helus-training-facility',
      title: 'Sgt. Ron Helus Training Facility Nears Full Operational Capacity',
      excerpt: 'Advanced live-fire and scenario-based training is now available to all sworn personnel. The Foundation continues to fund equipment and facility enhancements.',
      og_image: u['4.jpg'],
      published_at: '2025-06-01 00:00:00',
      body_html: `
        <p>Named in honor of Sgt. Ron Helus &mdash; a 29-year veteran of the Ventura County Sheriff's Office who gave his life responding to the 2018 Borderline Bar &amp; Grill shooting &mdash; the live-fire training facility represents the Foundation's largest single investment in deputy safety and readiness.</p>
        <p>Groundbreaking took place in 2021. Through 2024 and 2025, the complex has moved toward full operational capacity, delivering advanced tactical and decision-making training to deputies county-wide.</p>
        <figure><img src="${u['7.jpg']}" alt="Legacy of service and partnership in Ventura County"><figcaption>The facility stands as a permanent tribute to Sgt. Helus and every deputy who trains there.</figcaption></figure>
        <h2>Training for modern threats</h2>
        <p>The facility provides realistic, high-stress scenarios that prepare deputies for complex field threats &mdash; from active shooter response to de-escalation and tactical decision-making. That preparation protects both the public and the men and women who wear the badge.</p>
        <blockquote>&ldquo;Every deputy deserves access to the best possible preparation for the challenges of modern policing.&rdquo;</blockquote>
        <p>The Foundation also continues to support K9 and Mounted Patrol training facilities, including barns, arenas, and specialized training areas that keep specialized units mission-ready.</p>
        <figure><img src="${u['1.jpg']}" alt="Ventura County public safety and community support"><figcaption>Community investment translates directly into better training and safer outcomes.</figcaption></figure>
        <h2>Ongoing commitment</h2>
        <p>Equipment and facility enhancements remain a Foundation priority. Donors can designate gifts to the Sgt. Ron Helus Training Facility when giving online, ensuring their support strengthens the legacy of service Sgt. Helus embodied.</p>
      `.trim(),
    },
    {
      slug: 'grossman-scholarship-2026',
      title: 'Grossman Scholarship Applications Open for 2026',
      excerpt: '$2,500 scholarships are available for high-achieving children and dependents of VCSO employees and deputies.',
      og_image: u['9.jpg'],
      published_at: '2026-01-01 00:00:00',
      body_html: `
        <p>The Dr. Richard A. Grossman College Scholarship Fund provides <strong>$2,500 awards</strong> to graduating high school seniors or GED recipients who are the children or legal dependents of current Ventura County Sheriff's Office employees and sworn deputies in good standing.</p>
        <p>Applications for the 2026 cycle are open through the Ventura County Community Foundation (VCCF) AcademicWorks portal. The deadline for the current cycle is <strong>January 16, 2026</strong>.</p>
        <figure><img src="${u['8.jpg']}" alt="VCSF branded merchandise supporting Foundation programs"><figcaption>Supporting deputy families is a core part of the Foundation's mission.</figcaption></figure>
        <h2>Eligibility snapshot</h2>
        <p>Applicants typically need a minimum 3.0 GPA. Preference may be given to prior recipients. A 300&ndash;500 word essay is required, describing how being the son or daughter of a VCSO deputy or employee has influenced the applicant.</p>
        <blockquote>&ldquo;Investing in the next generation honors the families who share in the sacrifice of public service.&rdquo;</blockquote>
        <p>Applications are processed through the VCCF portal &mdash; not through a public form on this website &mdash; to ensure a consistent, fair review process for all eligible students.</p>
        <figure><img src="${u['2.jpg']}" alt="Community programs supporting deputy families"><figcaption>From scholarships to Shop with a Cop, the Foundation stands with deputy families year-round.</figcaption></figure>
        <h2>Apply or give</h2>
        <p><a href="https://vccf.academicworks.com/opportunities/3501" target="_blank" rel="noopener noreferrer">Apply via Ventura County Community Foundation &#8599;</a></p>
        <p>To support the scholarship fund or other Foundation programs, visit our <a href="/support#donate">donation page</a> or review details on the <a href="/applications">Applications</a> page.</p>
      `.trim(),
    },
  ];

  for (const p of posts) {
    const [[existing]] = await db.query('SELECT id FROM blog_posts WHERE slug = :slug', { slug: p.slug });
    if (existing) {
      await db.query(
        `UPDATE blog_posts SET title=:title, excerpt=:excerpt, body_html=:body_html, og_image=:og_image,
                status='published', published_at=:published_at, meta_title=:title, meta_desc=:excerpt
         WHERE id = :id`,
        { ...p, id: existing.id }
      );
      console.log(`Updated blog post "${p.slug}" (id ${existing.id}).`);
    } else {
      const [r] = await db.query(
        `INSERT INTO blog_posts (title, slug, status, excerpt, body_html, og_image, meta_title, meta_desc, published_at)
         VALUES (:title, :slug, 'published', :excerpt, :body_html, :og_image, :title, :excerpt, :published_at)`,
        p
      );
      console.log(`Created blog post "${p.slug}" (id ${r.insertId}).`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
