'use strict';
// =============================================================================
// AI service — chat streaming + knowledge base + live DB reporting tools
// =============================================================================
const Anthropic = require('@anthropic-ai/sdk');
const { db }    = require('../db');
const { sanitizeHtml } = require('./sanitizeHtml');

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS    = 2048;
const MAX_TOOL_ITER = 5;      // Safety cap on the agentic tool loop
const MASKED        = '••••••••';

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

async function getSettings() {
  const [rows] = await db.query('SELECT * FROM ai_settings ORDER BY id DESC LIMIT 1');
  return rows[0] || null;
}

async function getClient() {
  const s   = await getSettings();
  const key = (s?.active && s?.api_key) || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('AI assistant is not configured. Add your Anthropic API key under Settings → AI Assistant.');
  return { client: new Anthropic({ apiKey: key }), model: s?.model || DEFAULT_MODEL };
}

async function isAvailable() {
  try {
    const s   = await getSettings();
    const key = (s?.active && s?.api_key) || process.env.ANTHROPIC_API_KEY;
    return Boolean(key);
  } catch (_e) { return false; }
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

// Load all active KB articles. `module` (the page the user is currently on)
// only prioritizes ordering — it must never exclude other modules, or the
// assistant loses all context on anything outside the current page (e.g. a
// user on Settings asking about invoices would get zero invoice knowledge).
async function loadKnowledge(module) {
  const orderExpr = module ? '(module = :module) DESC, module, sort_order, id' : 'module, sort_order, id';
  const params = module ? { module } : {};
  const [rows] = await db.query(
    `SELECT module, title, content FROM ai_knowledge_base
      WHERE active = 1
      ORDER BY ${orderExpr}`,
    params,
  );
  return rows;
}

function buildSystemPrompt(articles, appName) {
  const sections  = [];
  let lastModule  = null;
  for (const a of articles) {
    if (a.module !== lastModule) { sections.push(`\n## ${a.module.toUpperCase()}`); lastModule = a.module; }
    sections.push(`### ${a.title}\n${a.content}`);
  }
  return `You are a friendly support assistant, business analyst, content creator, and action agent for ${appName || 'this app'}.
You can answer how-to questions, query live business data, create content, and take direct CRM actions.

KNOWLEDGE BASE:
${sections.join('\n\n')}

TOOL USE RULES — follow these exactly:
- HOW-TO questions ("how do I...", "how to create...", "where do I find...", "steps to..."): NEVER call tools. Answer directly and only from the knowledge base above.
- DATA questions ("how many", "what is revenue", "who owes", "show me my", "top clients"): use database tools — never make up numbers.
- CONTENT requests ("write a blog post", "write a social post", "create an email template"): write the content, then use the save tools.
- ACTION requests ("add a task", "remind me to", "create a contact", "add a deal", "mark done", "publish the post", "edit post"): use the action tools directly. Confirm what was done.

GUIDELINES:
- Quote navigation paths like "Settings → Integrations" for how-to answers.
- When presenting data: use $ for money, readable dates, bullet lists for multiple items.
- Keep how-to answers short and action-oriented. Use numbered steps.
- If a topic is not in the knowledge base, use your general CRM knowledge to give a helpful, practical answer. Note when you are giving general guidance rather than app-specific steps.

CONTENT CREATION:
- Blog posts: write a complete post (headline, intro, body with subheadings, conclusion), then call save_blog_draft to save it. Always status=draft.
- Social posts: Facebook = conversational; Instagram = visual-focused with 3–5 relevant hashtags; LinkedIn = professional insight. Call save_social_draft to save.
- Email templates: write a compelling subject + body using {{first_name}} and {{company_name}} merge tags. Call save_email_template to save.
- Page/website copy: write hero text, CTAs, feature descriptions, about sections — return in chat for copy-paste to the page builder.
- After saving, tell the user where to find it: blog drafts → Blog → Posts; social → Social → Posts; emails → Templates.
- Always write in a professional, warm business tone unless the user specifies otherwise. Ask for topic/audience details when needed.

CRM ACTIONS:
- Tasks: call create_task for new tasks. To complete a task: call get_open_tasks first to find the ID, then call complete_task. Always confirm the action.
- Contacts: call create_contact for new contacts. Use search_contacts to look someone up first.
- Deals: call create_deal. If you need a contact_id, call search_contacts first.
- Blog editing: call get_blog_posts to find the post, then update_blog_post to edit content or publish it.
- Always tell the user what was done and include the navigate_to path so they can find it in the app.`;
}

// ---------------------------------------------------------------------------
// Read-only DB reporting tools — definitions
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: 'get_invoice_summary',
    description: 'Get invoice counts and dollar totals grouped by status (draft, sent, overdue, partial, paid, void). Call this for any question about invoice counts, outstanding balances, or invoice status breakdown.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_revenue_summary',
    description: 'Get total collected revenue (net of fees) for a time period. Use for questions about revenue, income, earnings, or how much money came in.',
    input_schema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['this_month', 'last_month', 'this_quarter', 'this_year', 'all_time'],
          description: 'Time period to summarize',
        },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_contact_stats',
    description: 'Get total contact count, how many were added this month, and a breakdown by lifecycle stage. Use for any question about contacts or customers.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_deal_pipeline',
    description: 'Get deal counts and total value grouped by status (open, won, lost) and win rate. Use for questions about deals, pipeline, sales performance.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_subscription_stats',
    description: 'Get count of active subscriptions and estimated monthly recurring revenue (MRR). Use for questions about subscriptions or recurring revenue.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_task_summary',
    description: 'Get task counts by status and priority, plus overdue task count. Use for questions about tasks, to-dos, or workload.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_overdue_invoices',
    description: 'Get a list of overdue invoices with contact name, invoice number, amount owed, and days overdue. Use when someone asks which invoices are late or who owes money.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max results to return (default 10, max 25)' },
      },
      required: [],
    },
  },
  {
    name: 'get_recent_contacts',
    description: 'Get a list of the most recently added contacts. Use for "recent customers" or "new contacts" questions.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Number to return (default 10, max 25)' },
      },
      required: [],
    },
  },
  {
    name: 'get_top_clients',
    description: 'Get top clients ranked by total paid revenue. Use for questions about best customers, top accounts, or highest revenue contacts.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Number to return (default 10, max 25)' },
      },
      required: [],
    },
  },
  {
    name: 'get_payment_history',
    description: 'Get recent payment transactions with contact name, amount, and date. Use for questions about recent payments received.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Number to return (default 10, max 25)' },
      },
      required: [],
    },
  },

  // --- Content creation tools (write — always saves as draft) ---

  {
    name: 'get_social_accounts',
    description: 'Get connected social media accounts. Call this before save_social_draft to know which account IDs are available.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'save_blog_draft',
    description: 'Save a blog post as a DRAFT in the CMS. Call this after writing a blog post when the user wants it saved. Never publishes automatically.',
    input_schema: {
      type: 'object',
      properties: {
        title:   { type: 'string', description: 'Blog post headline' },
        content: { type: 'string', description: 'Full post body — plain text with blank lines between paragraphs. Markdown headings (## ) are supported.' },
        excerpt: { type: 'string', description: '1–2 sentence summary shown on the blog listing page' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'save_social_draft',
    description: 'Save a social media post as a DRAFT. Call this after writing post content when the user wants it saved.',
    input_schema: {
      type: 'object',
      properties: {
        platform:   { type: 'string', enum: ['facebook', 'instagram', 'linkedin'], description: 'Target platform' },
        content:    { type: 'string', description: 'Post text / caption' },
        account_id: { type: 'number', description: 'Social account ID from get_social_accounts (optional — can be assigned later)' },
      },
      required: ['platform', 'content'],
    },
  },
  {
    name: 'save_email_template',
    description: 'Save a new email template. Call this after writing email content when the user wants it saved as a reusable template.',
    input_schema: {
      type: 'object',
      properties: {
        name:     { type: 'string', description: 'Template name, e.g. "Welcome Email" or "Invoice Reminder"' },
        subject:  { type: 'string', description: 'Email subject line' },
        body:     { type: 'string', description: 'Email body. Use {{first_name}}, {{company_name}} as merge tags.' },
        category: { type: 'string', description: 'Category like "onboarding", "billing", "marketing", "general"' },
      },
      required: ['name', 'subject', 'body'],
    },
  },

  // --- CRM action tools (mutate DB on user command) ---

  {
    name: 'get_open_tasks',
    description: 'List open and in-progress tasks. Call this BEFORE complete_task to find the task ID when the user refers to a task by name.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional keyword to filter task titles' },
        limit:  { type: 'integer', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task. Use when the user says "add a task", "remind me to", "create a task for", or similar.',
    input_schema: {
      type: 'object',
      properties: {
        title:    { type: 'string',  description: 'Task title / description' },
        due_date: { type: 'string',  description: 'Due date in YYYY-MM-DD format (optional)' },
        priority: { type: 'string',  enum: ['low', 'normal', 'high', 'urgent'], description: 'Task priority (default: normal)' },
        notes:    { type: 'string',  description: 'Additional notes (optional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed. Use get_open_tasks first to find the task ID if you do not already have it.',
    input_schema: {
      type: 'object',
      properties: {
        id:    { type: 'number', description: 'Task ID (preferred — from get_open_tasks)' },
        title: { type: 'string', description: 'Partial task title to match if ID is unknown' },
      },
      required: [],
    },
  },
  {
    name: 'search_contacts',
    description: 'Search contacts by name or email. Use BEFORE create_deal to find the right contact_id, or to look up a contact.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string',  description: 'Name or email to search for' },
        limit: { type: 'integer', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_contact',
    description: 'Create a new contact. Use when the user says "add a contact", "create a new contact", "add a customer".',
    input_schema: {
      type: 'object',
      properties: {
        first_name:      { type: 'string', description: 'First name' },
        last_name:       { type: 'string', description: 'Last name (optional)' },
        email:           { type: 'string', description: 'Email address (optional)' },
        phone:           { type: 'string', description: 'Phone number (optional)' },
        lifecycle_stage: { type: 'string', enum: ['lead', 'mql', 'sql', 'customer', 'evangelist', 'other'], description: 'Lifecycle stage (default: lead)' },
      },
      required: ['first_name'],
    },
  },
  {
    name: 'create_deal',
    description: 'Create a new deal/opportunity. Use when the user says "add a deal", "create a deal", "log an opportunity".',
    input_schema: {
      type: 'object',
      properties: {
        title:      { type: 'string', description: 'Deal name / title' },
        contact_id: { type: 'number', description: 'Contact ID from search_contacts (optional)' },
        amount:     { type: 'number', description: 'Deal value in dollars (optional)' },
        notes:      { type: 'string', description: 'Additional notes (optional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_blog_posts',
    description: 'List blog posts. Call this BEFORE update_blog_post to find the post ID when the user refers to a post by title.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional keyword to filter by title' },
        status: { type: 'string', enum: ['draft', 'published', 'all'], description: 'Filter by status (default: all)' },
        limit:  { type: 'integer', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },
  {
    name: 'update_blog_post',
    description: 'Update an existing blog post — change title, content, or publish it. Use get_blog_posts first to find the post ID.',
    input_schema: {
      type: 'object',
      properties: {
        id:      { type: 'number', description: 'Blog post ID (from get_blog_posts)' },
        title:   { type: 'string', description: 'New title (optional)' },
        content: { type: 'string', description: 'New body content in markdown (optional)' },
        excerpt: { type: 'string', description: 'New excerpt/summary (optional)' },
        status:  { type: 'string', enum: ['draft', 'published'], description: 'Set to "published" to publish the post' },
      },
      required: ['id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Content-creation helpers
// ---------------------------------------------------------------------------

function toSlug(str) {
  return (str || 'draft').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function uniqueSlug(base, table) {
  const safe = base || 'draft';
  const [[{ n }]] = await db.query(
    `SELECT COUNT(*) AS n FROM \`${table}\` WHERE slug LIKE :p`,
    { p: `${safe}%` },
  );
  return n === 0 ? safe : `${safe}-${n + 1}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Security remediation C-05: the AI's content input is untrusted the same
// way any user input is — a KB article or contact note could steer the
// model into emitting a payload here via prompt injection, and this output
// is stored verbatim in blog_posts.body_html, then rendered on the public
// site via dangerouslySetInnerHTML. Escape FIRST, then apply the markdown
// transforms on top of the escaped text — so a literal `<script>` in the
// model's output becomes inert text, not a tag, while **bold**/headings
// still work exactly as before. DOMPurify below is defense in depth on top
// of this, not a substitute for it.
function markdownToHtml(text) {
  const html = (text || '').split(/\n{2,}/).filter((p) => p.trim()).map((p) => {
    const t = escapeHtml(p.trim());
    if (t.startsWith('### ')) return `<h3>${t.slice(4)}</h3>`;
    if (t.startsWith('## '))  return `<h2>${t.slice(3)}</h2>`;
    if (t.startsWith('# '))   return `<h1>${t.slice(2)}</h1>`;
    return `<p>${t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  // Defense in depth on top of the escaping above — sanitize the final
  // markup through the same shared sanitizer cms.js's human editor uses.
  return sanitizeHtml(html);
}

// Deals require a pipeline_id + stage_id (NOT NULL, no default). Pick the
// first pipeline and its earliest open-type stage as a sensible landing spot
// for AI-created deals — a human can move it from there.
async function defaultPipelineStage() {
  const [[pipeline]] = await db.query('SELECT id FROM pipelines ORDER BY id LIMIT 1');
  if (!pipeline) return null;
  const [[stage]] = await db.query(
    `SELECT id FROM stages WHERE pipeline_id = ? AND stage_type = 'open' ORDER BY display_order LIMIT 1`,
    [pipeline.id],
  );
  return stage ? { pipelineId: pipeline.id, stageId: stage.id } : null;
}

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

async function executeTool(name, input, userId) {
  const limit = Math.min(Number(input?.limit) || 10, 25);

  switch (name) {
    case 'get_invoice_summary': {
      const [rows] = await db.query(`
        SELECT status,
               COUNT(*)                     AS count,
               ROUND(SUM(total), 2)         AS total_amount,
               ROUND(SUM(balance_due), 2)   AS total_outstanding
          FROM invoices
         GROUP BY status
         ORDER BY FIELD(status, 'overdue', 'sent', 'partial', 'draft', 'paid', 'void')
      `);
      return { invoices_by_status: rows };
    }

    case 'get_revenue_summary': {
      const period    = input?.period || 'this_month';
      const periodSQL = {
        this_month:    `YEAR(received_at)  = YEAR(CURDATE()) AND MONTH(received_at) = MONTH(CURDATE())`,
        last_month:    `received_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
                          AND received_at < DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
        this_quarter:  `YEAR(received_at)  = YEAR(CURDATE()) AND QUARTER(received_at) = QUARTER(CURDATE())`,
        this_year:     `YEAR(received_at)  = YEAR(CURDATE())`,
        all_time:      `1=1`,
      }[period] || '1=1';

      const [[revenue]] = await db.query(`
        SELECT ROUND(SUM(amount - COALESCE(fee_amount, 0)), 2) AS net_revenue,
               ROUND(SUM(amount), 2)                           AS gross_revenue,
               COUNT(*)                                        AS payment_count
          FROM payments
         WHERE status IN ('captured', 'authorized')
           AND ${periodSQL}
      `);
      return { period, ...revenue };
    }

    case 'get_contact_stats': {
      const [[totals]] = await db.query(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN 1 ELSE 0 END) AS new_this_month
          FROM contacts
      `);
      const [byStage] = await db.query(`
        SELECT COALESCE(lifecycle_stage, 'none') AS lifecycle_stage, COUNT(*) AS count
          FROM contacts
         GROUP BY lifecycle_stage
         ORDER BY count DESC
      `);
      return { ...totals, by_lifecycle_stage: byStage };
    }

    case 'get_deal_pipeline': {
      const [byStatus] = await db.query(`
        SELECT status,
               COUNT(*)                  AS count,
               ROUND(SUM(amount), 2)     AS total_value
          FROM deals
         GROUP BY status
      `);
      const [[wr]] = await db.query(`
        SELECT ROUND(
                 100.0 * SUM(CASE WHEN status = 'won'  THEN 1 ELSE 0 END) /
                 NULLIF(SUM(CASE WHEN status IN ('won','lost') THEN 1 ELSE 0 END), 0),
               1) AS win_rate_pct
          FROM deals
      `);
      return { by_status: byStatus, win_rate_pct: wr?.win_rate_pct };
    }

    case 'get_subscription_stats': {
      const [[stats]] = await db.query(`
        SELECT COUNT(*) AS active_count,
               ROUND(SUM(
                 CASE s.interval_unit
                   WHEN 'month' THEN si.item_total / s.interval_count
                   WHEN 'year'  THEN si.item_total / s.interval_count / 12
                   WHEN 'week'  THEN si.item_total / s.interval_count * 4.33
                   WHEN 'day'   THEN si.item_total / s.interval_count * 30.44
                   ELSE 0
                 END
               ), 2) AS estimated_mrr
          FROM subscriptions s
          JOIN (
                SELECT subscription_id, SUM(quantity * unit_price) AS item_total
                  FROM subscription_items
                 GROUP BY subscription_id
               ) si ON si.subscription_id = s.id
         WHERE s.status = 'active'
      `);
      return stats || { active_count: 0, estimated_mrr: 0 };
    }

    case 'get_task_summary': {
      const [byStatus] = await db.query(`
        SELECT status, COUNT(*) AS count FROM tasks GROUP BY status
      `);
      const [byPriority] = await db.query(`
        SELECT priority, COUNT(*) AS count
          FROM tasks
         WHERE status NOT IN ('completed','cancelled')
         GROUP BY priority
         ORDER BY FIELD(priority,'urgent','high','normal','low')
      `);
      const [[overdue]] = await db.query(`
        SELECT COUNT(*) AS overdue_count
          FROM tasks
         WHERE due_date < NOW() AND status NOT IN ('completed','cancelled')
      `);
      return { by_status: byStatus, by_priority: byPriority, ...overdue };
    }

    case 'get_overdue_invoices': {
      const [rows] = await db.query(`
        SELECT i.invoice_number,
               ROUND(i.total, 2)        AS total,
               ROUND(i.balance_due, 2)  AS balance_due,
               i.due_date,
               DATEDIFF(CURDATE(), i.due_date)        AS days_overdue,
               CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
               c.email                                AS contact_email
          FROM invoices i
          LEFT JOIN contacts c ON c.id = i.contact_id
         WHERE i.status IN ('overdue','sent','partial') AND i.due_date < CURDATE()
         ORDER BY i.due_date ASC
         LIMIT :limit
      `, { limit });
      return { overdue_invoices: rows };
    }

    case 'get_recent_contacts': {
      const [rows] = await db.query(`
        SELECT c.first_name, c.last_name, c.email, c.phone,
               c.lifecycle_stage, c.created_at,
               o.name AS organization_name
          FROM contacts c
          LEFT JOIN organizations o ON o.id = c.organization_id
         ORDER BY c.created_at DESC
         LIMIT :limit
      `, { limit });
      return { recent_contacts: rows };
    }

    case 'get_top_clients': {
      const [rows] = await db.query(`
        SELECT CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
               c.email,
               COUNT(DISTINCT i.id)                                 AS invoice_count,
               ROUND(SUM(p.amount - COALESCE(p.fee_amount, 0)), 2) AS total_paid
          FROM contacts c
          JOIN invoices i ON i.contact_id = c.id
          JOIN payments p ON p.invoice_id = i.id AND p.status IN ('captured','authorized')
         GROUP BY c.id, c.first_name, c.last_name, c.email
         ORDER BY total_paid DESC
         LIMIT :limit
      `, { limit });
      return { top_clients: rows };
    }

    case 'get_payment_history': {
      const [rows] = await db.query(`
        SELECT ROUND(p.amount, 2) AS amount,
               p.gateway, p.method,
               COALESCE(p.received_at, p.created_at) AS paid_at,
               i.invoice_number,
               CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
          FROM payments p
          JOIN invoices i  ON i.id = p.invoice_id
          LEFT JOIN contacts c ON c.id = i.contact_id
         WHERE p.status IN ('captured','authorized')
         ORDER BY COALESCE(p.received_at, p.created_at) DESC
         LIMIT :limit
      `, { limit });
      return { recent_payments: rows };
    }

    case 'get_social_accounts': {
      const [rows] = await db.query(
        `SELECT id, platform, account_name, page_name, is_active
           FROM social_accounts WHERE is_active = 1 ORDER BY platform`,
      );
      return { social_accounts: rows };
    }

    case 'save_blog_draft': {
      const { title, content, excerpt } = input;
      if (!title || !content) return { error: 'title and content are required' };
      const slug    = await uniqueSlug(toSlug(title), 'blog_posts');
      const bodyHtml = markdownToHtml(content);
      const [result] = await db.query(
        `INSERT INTO blog_posts (title, slug, status, excerpt, body_html, author_id)
         VALUES (:title, :slug, 'draft', :excerpt, :body_html, :author_id)`,
        { title, slug, excerpt: excerpt || null, body_html: bodyHtml, author_id: userId || null },
      );
      return { saved: true, id: result.insertId, title, slug, navigate_to: `/blog-posts/${result.insertId}/edit` };
    }

    case 'save_social_draft': {
      const { platform, content, account_id } = input;
      if (!platform || !content) return { error: 'platform and content are required' };
      const [result] = await db.query(
        `INSERT INTO social_posts (account_id, platform, content, media_urls, status, created_by)
         VALUES (:account_id, :platform, :content, '[]', 'draft', :created_by)`,
        { account_id: account_id || null, platform, content, created_by: userId || null },
      );
      return { saved: true, id: result.insertId, platform, navigate_to: '/marketing/social-composer' };
    }

    case 'save_email_template': {
      const { name, subject, body, category } = input;
      if (!name || !subject || !body) return { error: 'name, subject, and body are required' };
      const slug = await uniqueSlug(toSlug(name), 'message_templates');
      const [result] = await db.query(
        `INSERT INTO message_templates (channel, name, slug, category, subject, body, is_active, created_by)
         VALUES ('email', :name, :slug, :category, :subject, :body, 1, :created_by)`,
        { name, slug, category: category || 'general', subject, body, created_by: userId || null },
      );
      return { saved: true, id: result.insertId, name, navigate_to: '/comms/templates' };
    }

    // --- CRM action handlers ---

    case 'get_open_tasks': {
      const { search } = input;
      let sql = `SELECT id, title, status, priority, due_date
                   FROM tasks
                  WHERE status IN ('open','in_progress')`;
      const params = [];
      if (search) { sql += ' AND title LIKE ?'; params.push(`%${search}%`); }
      sql += ` ORDER BY FIELD(priority,'urgent','high','normal','low'), due_date ASC LIMIT ?`;
      params.push(limit);
      const [rows] = await db.query(sql, params);
      return { open_tasks: rows };
    }

    case 'create_task': {
      const { title, due_date, priority, notes } = input;
      if (!title) return { error: 'title is required' };
      const [result] = await db.query(
        `INSERT INTO tasks (title, due_date, priority, status, description, created_by)
         VALUES (?, ?, ?, 'open', ?, ?)`,
        [title, due_date || null, priority || 'normal', notes || null, userId || null],
      );
      return { ok: true, id: result.insertId, message: `Task "${title}" created.`, navigate_to: '/tasks' };
    }

    case 'complete_task': {
      const { id: taskId, title: titleSearch } = input;
      if (!taskId && !titleSearch) return { error: 'Provide either id or title to identify the task.' };
      let resolvedId = taskId;
      let resolvedTitle = null;
      if (!resolvedId) {
        const [[found]] = await db.query(
          `SELECT id, title FROM tasks WHERE title LIKE ? AND status NOT IN ('completed','cancelled') LIMIT 1`,
          [`%${titleSearch}%`],
        );
        if (!found) return { error: `No open task found matching "${titleSearch}"` };
        resolvedId  = found.id;
        resolvedTitle = found.title;
      }
      await db.query(`UPDATE tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?`, [resolvedId]);
      return { ok: true, id: resolvedId, message: `Task "${resolvedTitle || `#${resolvedId}`}" marked as completed.` };
    }

    case 'search_contacts': {
      const { query } = input;
      if (!query) return { error: 'query is required' };
      const [rows] = await db.query(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
                o.name AS organization
           FROM contacts c
           LEFT JOIN organizations o ON o.id = c.organization_id
          WHERE c.first_name LIKE :q OR c.last_name LIKE :q OR c.email LIKE :q
             OR CONCAT(c.first_name, ' ', c.last_name) LIKE :q
          ORDER BY c.first_name, c.last_name
          LIMIT :limit`,
        { q: `%${query}%`, limit },
      );
      return { contacts: rows };
    }

    case 'create_contact': {
      const { first_name, last_name, email, phone, lifecycle_stage } = input;
      if (!first_name) return { error: 'first_name is required' };
      const [result] = await db.query(
        `INSERT INTO contacts (first_name, last_name, email, phone, lifecycle_stage, owner_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [first_name, last_name || null, email || null, phone || null, lifecycle_stage || 'lead', userId || null],
      );
      const displayName = [first_name, last_name].filter(Boolean).join(' ');
      return { ok: true, id: result.insertId, message: `Contact "${displayName}" created.`, navigate_to: `/contacts/${result.insertId}` };
    }

    case 'create_deal': {
      const { title, contact_id, amount, notes } = input;
      if (!title) return { error: 'title is required' };
      const stage = await defaultPipelineStage();
      if (!stage) return { error: 'No pipeline/stage configured — create one under Settings → Pipelines first.' };
      const [result] = await db.query(
        `INSERT INTO deals (name, pipeline_id, stage_id, primary_contact_id, amount, status, description, owner_id)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
        [title, stage.pipelineId, stage.stageId, contact_id || null, amount || 0, notes || null, userId || null],
      );
      return { ok: true, id: result.insertId, message: `Deal "${title}" created.`, navigate_to: `/deals/${result.insertId}` };
    }

    case 'get_blog_posts': {
      const { search, status: statusFilter } = input;
      let sql = `SELECT id, title, status, excerpt, created_at FROM blog_posts WHERE 1=1`;
      const params = [];
      if (search) { sql += ' AND title LIKE ?'; params.push(`%${search}%`); }
      if (statusFilter && statusFilter !== 'all') { sql += ' AND status = ?'; params.push(statusFilter); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const [rows] = await db.query(sql, params);
      return { blog_posts: rows };
    }

    case 'update_blog_post': {
      const { id, title, content, excerpt, status: newStatus } = input;
      if (!id) return { error: 'id is required' };
      const [[existing]] = await db.query('SELECT id, title FROM blog_posts WHERE id = ?', [id]);
      if (!existing) return { error: `Blog post #${id} not found` };
      const sets = []; const vals = [];
      if (title)                       { sets.push('title = ?');    vals.push(title); }
      if (content)                     { sets.push('body_html = ?'); vals.push(markdownToHtml(content)); }
      if (excerpt !== undefined)       { sets.push('excerpt = ?');   vals.push(excerpt); }
      if (newStatus)                   { sets.push('status = ?');    vals.push(newStatus); }
      if (newStatus === 'published')   { sets.push('published_at = COALESCE(published_at, NOW())'); }
      if (!sets.length) return { error: 'No fields to update — provide at least one of: title, content, excerpt, status' };
      vals.push(id);
      await db.query(`UPDATE blog_posts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, vals);
      const action = newStatus === 'published' ? 'published' : 'updated';
      return { ok: true, id, message: `Blog post "${existing.title}" ${action}.`, navigate_to: `/blog-posts/${id}/edit` };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// streamChat — agentic loop with DB tool support
// ---------------------------------------------------------------------------

async function streamChat(res, messages, module, appName, userId = null) {
  // Open the SSE stream immediately — before any async DB/API work.
  // This ensures Railway's proxy knows it's a streaming response right away,
  // and any setup errors arrive as proper SSE events (not an abrupt HTTP error
  // that the browser's ReadableStream surfaces as a network exception).
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering on Railway
  res.flushHeaders();
  res.write(': ok\n\n'); // prime the proxy — forces first flush immediately

  function sseError(msg) {
    if (!res.writableEnded) {
      try { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); res.end(); } catch (_) {}
    }
  }

  // Get API client — send SSE error if key is missing
  let client, model;
  try {
    ({ client, model } = await getClient());
  } catch (err) {
    sseError(err.message);
    return;
  }

  // Build KB context — cap at 35 articles to keep the prompt lean.
  // When a module is known, prioritise its articles then fill with general ones.
  // KB failure is non-fatal — continue without knowledge base articles.
  const MAX_ARTICLES = 35;
  let articles = [];
  try {
    if (module) {
      const primary   = await loadKnowledge(module);
      const secondary = await loadKnowledge(null);
      const seen      = new Set(primary.map((a) => a.title));
      const fill      = secondary.filter((a) => !seen.has(a.title)).slice(0, MAX_ARTICLES - primary.length);
      articles = [...primary, ...fill];
    } else {
      articles = (await loadKnowledge(null)).slice(0, MAX_ARTICLES);
    }
  } catch (_) { /* KB load failure — continue with empty context */ }

  const system = buildSystemPrompt(articles, appName);

  // Anthropic requires conversations to start with a user message.
  // The UI seeds a greeting (role: assistant) before any user turn — strip it.
  const msgHistory = messages
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
    .filter((_, i, arr) => {
      // Drop leading assistant messages
      const firstUser = arr.findIndex((m) => m.role === 'user');
      return i >= firstUser;
    });

  if (!msgHistory.length) {
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  // Agentic loop: stream → check for tool calls → execute → stream final answer
  for (let iter = 0; iter < MAX_TOOL_ITER; iter++) {
    let final;
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages:   msgHistory,
        tools:      TOOL_DEFINITIONS,
        tool_choice: { type: 'auto' },
      });

      stream.on('text', (text) => res.write(`data: ${JSON.stringify({ text })}\n\n`));

      final = await stream.finalMessage();
    } catch (err) {
      sseError(err.message);
      return;
    }

    if (final.stop_reason !== 'tool_use') {
      // No more tool calls — done
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Push the assistant's tool_use message to history
    msgHistory.push({ role: 'assistant', content: final.content });

    // Execute all tool calls (parallel)
    const toolUseBlocks = final.content.filter((b) => b.type === 'tool_use');
    const toolResults   = await Promise.all(
      toolUseBlocks.map(async (block) => {
        let result;
        try   { result = await executeTool(block.name, block.input, userId); }
        catch (err) { result = { error: err.message }; }
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) };
      }),
    );

    // Push tool results and loop for Claude's follow-up response
    msgHistory.push({ role: 'user', content: toolResults });
  }

  // Safety fallback — shouldn't reach here in normal usage
  res.write('data: [DONE]\n\n');
  res.end();
}

// markdownToHtml is exported for direct testing (security remediation C-05
// regression test) — it has no other external caller.
module.exports = { streamChat, loadKnowledge, getSettings, isAvailable, MASKED, markdownToHtml };
