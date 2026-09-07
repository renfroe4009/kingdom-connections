// =============================================================================
// reportRegistry.js — module/column/filter metadata for the custom Report Builder
// -----------------------------------------------------------------------------
// Single source of truth for which tables/columns a saved report may touch.
// Every SQL identifier (table, alias, column) a report can reference comes
// from this file, never from user input — reportQuery.js only ever accepts a
// column *key* (e.g. "first_name") and looks up the real `c.first_name` SQL
// fragment here, so there's no path from request data to arbitrary SQL.
// =============================================================================

const MODULES = {
  contacts: {
    label: 'Contacts',
    table: 'contacts', alias: 'c',
    joins: [
      { table: 'organizations', alias: 'org', on: 'org.id = c.organization_id' },
    ],
    scope: (scopeIds) => require('./scope').ownerClause(scopeIds, 'c.owner_id'),
    columns: {
      first_name:        { label: 'First Name',    sql: 'c.first_name',    type: 'text' },
      last_name:         { label: 'Last Name',     sql: 'c.last_name',     type: 'text' },
      email:             { label: 'Email',         sql: 'c.email',         type: 'text' },
      phone:             { label: 'Phone',         sql: 'c.phone',         type: 'text' },
      mobile:            { label: 'Mobile',        sql: 'c.mobile',        type: 'text' },
      title:             { label: 'Job Title',     sql: 'c.title',         type: 'text' },
      department:        { label: 'Department',    sql: 'c.department',    type: 'text' },
      organization_name: { label: 'Organization',  sql: 'org.name',        type: 'text' },
      lifecycle_stage:   { label: 'Lifecycle Stage', sql: 'c.lifecycle_stage', type: 'enum', options: ['lead', 'mql', 'sql', 'customer', 'evangelist', 'other'] },
      lead_source:       { label: 'Lead Source',   sql: 'c.lead_source',   type: 'text' },
      city:              { label: 'City',          sql: 'c.city',          type: 'text' },
      state:             { label: 'State',         sql: 'c.state',         type: 'text' },
      country:           { label: 'Country',       sql: 'c.country',       type: 'text' },
      notes:             { label: 'Notes',         sql: 'c.notes',         type: 'text' },
      created_at:        { label: 'Created',       sql: 'c.created_at',    type: 'date' },
      updated_at:        { label: 'Updated',       sql: 'c.updated_at',    type: 'date' },
    },
    defaultColumns: ['first_name', 'last_name', 'email', 'phone', 'organization_name', 'lifecycle_stage', 'created_at'],
    defaultSort: { field: 'created_at', dir: 'desc' },
  },

  organizations: {
    label: 'Organizations',
    table: 'organizations', alias: 'o',
    joins: [],
    scope: (scopeIds) => require('./scope').ownerClause(scopeIds, 'o.owner_id'),
    columns: {
      name:            { label: 'Name',           sql: 'o.name',           type: 'text' },
      website:         { label: 'Website',        sql: 'o.website',        type: 'text' },
      phone:           { label: 'Phone',          sql: 'o.phone',          type: 'text' },
      industry:        { label: 'Industry',       sql: 'o.industry',       type: 'text' },
      employee_count:  { label: 'Employees',      sql: 'o.employee_count', type: 'number' },
      annual_revenue:  { label: 'Annual Revenue', sql: 'o.annual_revenue', type: 'currency' },
      city:            { label: 'City',           sql: 'o.city',           type: 'text' },
      state:           { label: 'State',          sql: 'o.state',          type: 'text' },
      country:         { label: 'Country',        sql: 'o.country',        type: 'text' },
      notes:           { label: 'Notes',          sql: 'o.notes',          type: 'text' },
      created_at:      { label: 'Created',        sql: 'o.created_at',     type: 'date' },
      updated_at:      { label: 'Updated',        sql: 'o.updated_at',     type: 'date' },
    },
    defaultColumns: ['name', 'industry', 'phone', 'city', 'state', 'created_at'],
    defaultSort: { field: 'created_at', dir: 'desc' },
  },

  deals: {
    label: 'Deals',
    table: 'deals', alias: 'd',
    joins: [
      { table: 'organizations', alias: 'org',   on: 'org.id = d.organization_id' },
      { table: 'contacts',      alias: 'pc',    on: 'pc.id = d.primary_contact_id' },
      { table: 'stages',        alias: 'st',    on: 'st.id = d.stage_id' },
      { table: 'pipelines',     alias: 'pl',    on: 'pl.id = d.pipeline_id' },
    ],
    scope: (scopeIds) => require('./scope').ownerClause(scopeIds, 'd.owner_id'),
    columns: {
      name:                 { label: 'Deal Name',       sql: 'd.name',                 type: 'text' },
      organization_name:    { label: 'Organization',    sql: 'org.name',               type: 'text' },
      contact_name:         { label: 'Primary Contact',  sql: "TRIM(CONCAT_WS(' ', pc.first_name, pc.last_name))", type: 'text' },
      pipeline_name:        { label: 'Pipeline',         sql: 'pl.name',                type: 'text' },
      stage_name:           { label: 'Stage',            sql: 'st.name',                type: 'text' },
      amount:               { label: 'Amount',           sql: 'd.amount',               type: 'currency' },
      status:               { label: 'Status',           sql: 'd.status',               type: 'enum', options: ['open', 'won', 'lost'] },
      probability:          { label: 'Probability %',    sql: 'd.probability',          type: 'number' },
      expected_close_date:  { label: 'Expected Close',   sql: 'd.expected_close_date',  type: 'date' },
      won_at:               { label: 'Won Date',         sql: 'd.won_at',               type: 'date' },
      lost_reason:          { label: 'Lost Reason',      sql: 'd.lost_reason',          type: 'text' },
      description:          { label: 'Description',      sql: 'd.description',          type: 'text' },
      created_at:           { label: 'Created',          sql: 'd.created_at',           type: 'date' },
      updated_at:           { label: 'Updated',          sql: 'd.updated_at',           type: 'date' },
    },
    defaultColumns: ['name', 'organization_name', 'stage_name', 'amount', 'status', 'expected_close_date'],
    defaultSort: { field: 'created_at', dir: 'desc' },
  },

  tasks: {
    label: 'Tasks',
    table: 'tasks', alias: 't',
    joins: [
      { table: 'users', alias: 'au', on: 'au.id = t.assigned_to' },
      { table: 'users', alias: 'cu', on: 'cu.id = t.created_by' },
    ],
    scope: (scopeIds) => require('./scope').taskClause(scopeIds),
    columns: {
      title:          { label: 'Title',        sql: 't.title',        type: 'text' },
      description:    { label: 'Description',  sql: 't.description',  type: 'text' },
      priority:       { label: 'Priority',     sql: 't.priority',     type: 'enum', options: ['low', 'normal', 'high', 'urgent'] },
      status:         { label: 'Status',       sql: 't.status',       type: 'enum', options: ['open', 'in_progress', 'completed', 'cancelled'] },
      assigned_to_name: { label: 'Assigned To', sql: "TRIM(CONCAT_WS(' ', au.first_name, au.last_name))", type: 'text' },
      created_by_name:  { label: 'Created By',  sql: "TRIM(CONCAT_WS(' ', cu.first_name, cu.last_name))", type: 'text' },
      entity_type:    { label: 'Related To Type', sql: 't.entity_type', type: 'enum', options: ['contact', 'organization', 'deal'] },
      due_date:       { label: 'Due Date',     sql: 't.due_date',     type: 'date' },
      completed_at:   { label: 'Completed',    sql: 't.completed_at', type: 'date' },
      created_at:     { label: 'Created',      sql: 't.created_at',   type: 'date' },
    },
    defaultColumns: ['title', 'status', 'priority', 'assigned_to_name', 'due_date'],
    defaultSort: { field: 'due_date', dir: 'asc' },
  },

  invoices: {
    label: 'Invoices',
    table: 'invoices', alias: 'i',
    joins: [
      { table: 'contacts',      alias: 'c',   on: 'c.id = i.contact_id' },
      { table: 'organizations', alias: 'org', on: 'org.id = i.organization_id' },
    ],
    scope: (scopeIds) => require('./scope').contactOwnerClause(scopeIds, 'i.contact_id'),
    columns: {
      invoice_number: { label: 'Invoice #',     sql: 'i.invoice_number', type: 'text' },
      contact_name:   { label: 'Contact',       sql: "TRIM(CONCAT_WS(' ', c.first_name, c.last_name))", type: 'text' },
      organization_name: { label: 'Organization', sql: 'org.name',       type: 'text' },
      status:         { label: 'Status',        sql: 'i.status',         type: 'enum', options: ['draft', 'sent', 'partial', 'paid', 'overdue', 'void', 'refunded'] },
      issue_date:     { label: 'Issue Date',    sql: 'i.issue_date',     type: 'date' },
      due_date:       { label: 'Due Date',      sql: 'i.due_date',       type: 'date' },
      total:          { label: 'Total',         sql: 'i.total',          type: 'currency' },
      amount_paid:    { label: 'Amount Paid',   sql: 'i.amount_paid',    type: 'currency' },
      balance_due:    { label: 'Balance Due',   sql: 'i.balance_due',    type: 'currency' },
      processing_fee: { label: 'Processing Fee', sql: 'i.processing_fee', type: 'currency' },
      fee_label:      { label: 'Fee Label',     sql: 'i.fee_label',      type: 'text' },
      paid_at:        { label: 'Paid Date',     sql: 'i.paid_at',        type: 'date' },
      memo:           { label: 'Memo',          sql: 'i.memo',           type: 'text' },
      created_at:     { label: 'Created',       sql: 'i.created_at',     type: 'date' },
    },
    defaultColumns: ['invoice_number', 'contact_name', 'status', 'total', 'balance_due', 'due_date'],
    defaultSort: { field: 'issue_date', dir: 'desc' },
  },

  payments: {
    label: 'Payments',
    table: 'payments', alias: 'p',
    joins: [
      { table: 'invoices',  alias: 'i', on: 'i.id = p.invoice_id' },
      { table: 'contacts',  alias: 'c', on: 'c.id = i.contact_id' },
    ],
    scope: (scopeIds) => require('./scope').contactOwnerClause(scopeIds, 'i.contact_id'),
    columns: {
      invoice_number: { label: 'Invoice #',   sql: 'i.invoice_number', type: 'text' },
      contact_name:   { label: 'Contact',     sql: "TRIM(CONCAT_WS(' ', c.first_name, c.last_name))", type: 'text' },
      gateway:        { label: 'Gateway',     sql: 'p.gateway',        type: 'enum', options: ['valor', 'authnet', 'manual'] },
      method:         { label: 'Method',      sql: 'p.method',         type: 'enum', options: ['card', 'ach', 'check', 'cash', 'wire', 'other'] },
      status:         { label: 'Status',      sql: 'p.status',         type: 'enum', options: ['pending', 'authorized', 'captured', 'failed', 'refunded', 'voided'] },
      amount:         { label: 'Amount',      sql: 'p.amount',         type: 'currency' },
      fee_amount:     { label: 'Fee',         sql: 'p.fee_amount',     type: 'currency' },
      fee_label:      { label: 'Fee Label',   sql: 'p.fee_label',      type: 'text' },
      card_brand:     { label: 'Card Brand',  sql: 'p.card_brand',     type: 'text' },
      card_last4:     { label: 'Card Last 4', sql: 'p.card_last4',     type: 'text' },
      received_at:    { label: 'Received',    sql: 'p.received_at',    type: 'date' },
      created_at:     { label: 'Created',     sql: 'p.created_at',     type: 'date' },
    },
    defaultColumns: ['invoice_number', 'contact_name', 'amount', 'status', 'method', 'received_at'],
    defaultSort: { field: 'created_at', dir: 'desc' },
  },

  subscriptions: {
    label: 'Recurring',
    table: 'subscriptions', alias: 's',
    joins: [
      { table: 'contacts',      alias: 'c',   on: 'c.id = s.contact_id' },
      { table: 'organizations', alias: 'org', on: 'org.id = s.organization_id' },
    ],
    scope: (scopeIds) => require('./scope').contactOwnerClause(scopeIds, 's.contact_id'),
    columns: {
      name:              { label: 'Name',           sql: 's.name',              type: 'text' },
      contact_name:      { label: 'Contact',        sql: "TRIM(CONCAT_WS(' ', c.first_name, c.last_name))", type: 'text' },
      organization_name: { label: 'Organization',   sql: 'org.name',            type: 'text' },
      status:            { label: 'Status',         sql: 's.status',            type: 'enum', options: ['active', 'paused', 'canceled', 'completed'] },
      interval_unit:     { label: 'Billing Interval', sql: 's.interval_unit',   type: 'enum', options: ['day', 'week', 'month', 'year'] },
      start_date:        { label: 'Start Date',     sql: 's.start_date',        type: 'date' },
      next_run_date:     { label: 'Next Run',       sql: 's.next_run_date',     type: 'date' },
      end_date:          { label: 'End Date',       sql: 's.end_date',          type: 'date' },
      gateway:           { label: 'Gateway',        sql: 's.gateway',           type: 'enum', options: ['valor', 'authnet', 'none'] },
      created_at:        { label: 'Created',        sql: 's.created_at',        type: 'date' },
    },
    defaultColumns: ['name', 'contact_name', 'status', 'interval_unit', 'next_run_date'],
    defaultSort: { field: 'created_at', dir: 'desc' },
  },

  recurring_invoices: {
    label: 'Recurring Invoices',
    table: 'recurring_invoices', alias: 'ri',
    joins: [
      { table: 'contacts',      alias: 'c',   on: 'c.id = ri.contact_id' },
      { table: 'organizations', alias: 'org', on: 'org.id = ri.organization_id' },
    ],
    scope: (scopeIds) => require('./scope').contactOwnerClause(scopeIds, 'ri.contact_id'),
    columns: {
      name:              { label: 'Name',          sql: 'ri.name',              type: 'text' },
      contact_name:      { label: 'Contact',       sql: "TRIM(CONCAT_WS(' ', c.first_name, c.last_name))", type: 'text' },
      organization_name: { label: 'Organization',  sql: 'org.name',             type: 'text' },
      status:            { label: 'Status',        sql: 'ri.status',            type: 'enum', options: ['active', 'paused', 'completed', 'canceled'] },
      interval_unit:     { label: 'Billing Interval', sql: 'ri.interval_unit',  type: 'enum', options: ['week', 'month', 'year'] },
      next_run_date:     { label: 'Next Run',      sql: 'ri.next_run_date',     type: 'date' },
      occurrences_run:   { label: 'Occurrences Run', sql: 'ri.occurrences_run', type: 'number' },
      created_at:        { label: 'Created',       sql: 'ri.created_at',        type: 'date' },
    },
    defaultColumns: ['name', 'contact_name', 'status', 'interval_unit', 'next_run_date'],
    defaultSort: { field: 'created_at', dir: 'desc' },
  },

  donations: {
    label: 'Donations',
    table: 'donations', alias: 'd',
    joins: [
      { table: 'funds',         alias: 'f',  on: 'f.id = d.fund_id' },
      { table: 'contacts',      alias: 'c',  on: 'c.id = d.contact_id' },
      { table: 'organizations', alias: 'org', on: 'org.id = d.organization_id' },
      { table: 'payments',      alias: 'p',  on: 'p.id = d.payment_id' },
      { table: 'invoices',      alias: 'i',  on: 'i.id = d.invoice_id' },
    ],
    scope: (scopeIds) => require('./scope').contactOwnerClause(scopeIds, 'd.contact_id'),
    columns: {
      fund_name:          {
        label: 'Fund', sql: 'f.name', type: 'enum',
        dynamicOptions: async () => {
          const { db } = require('../db');
          const [rows] = await db.query('SELECT name FROM funds WHERE is_active = 1 ORDER BY name');
          return rows.map((r) => r.name);
        },
      },
      fund_code:          { label: 'Fund Code',       sql: 'f.fund_code',            type: 'text' },
      contact_name:       { label: 'Donor',           sql: "TRIM(CONCAT_WS(' ', c.first_name, c.last_name))", type: 'text' },
      donor_email:        { label: 'Donor Email',     sql: 'c.email',                type: 'text' },
      donor_phone:        { label: 'Donor Phone',     sql: 'c.phone',                type: 'text' },
      donor_address_line1: { label: 'Address Line 1', sql: 'c.address_line1',        type: 'text' },
      donor_address_line2: { label: 'Address Line 2', sql: 'c.address_line2',        type: 'text' },
      donor_city:         { label: 'City',            sql: 'c.city',                 type: 'text' },
      donor_state:        { label: 'State',           sql: 'c.state',                type: 'text' },
      donor_postal_code:  { label: 'Postal Code',     sql: 'c.postal_code',          type: 'text' },
      donor_country:      { label: 'Country',         sql: 'c.country',              type: 'text' },
      organization_name:  { label: 'Organization',    sql: 'org.name',               type: 'text' },
      amount:             { label: 'Amount',          sql: 'p.amount',               type: 'currency' },
      fee_amount:         { label: 'Fee',             sql: 'p.fee_amount',           type: 'currency' },
      fee_label:          { label: 'Fee Label',       sql: 'p.fee_label',            type: 'text' },
      quid_pro_quo_value: { label: 'Quid Pro Quo Value', sql: 'd.quid_pro_quo_value', type: 'currency' },
      payment_status:     { label: 'Payment Status',  sql: 'p.status',               type: 'enum', options: ['pending', 'authorized', 'captured', 'failed', 'refunded', 'voided'] },
      method:             { label: 'Method',          sql: 'p.method',               type: 'enum', options: ['card', 'ach', 'check', 'cash', 'wire', 'other'] },
      source:             { label: 'Source',          sql: 'd.source',               type: 'enum', options: ['form', 'manual', 'sms'] },
      is_anonymous:       { label: 'Anonymous',       sql: "IF(d.is_anonymous, 'Yes', 'No')", type: 'enum', options: ['Yes', 'No'] },
      is_in_kind:         { label: 'In-Kind',         sql: "IF(d.is_in_kind, 'Yes', 'No')",   type: 'enum', options: ['Yes', 'No'] },
      in_kind_description: { label: 'In-Kind Description', sql: 'd.in_kind_description', type: 'text' },
      dedication_note:    { label: 'Dedication Note', sql: 'd.dedication_note',      type: 'text' },
      matching_gift_state: { label: 'Matching Gift Status', sql: 'd.matching_gift_state', type: 'enum', options: ['none', 'eligible', 'submitted', 'matched', 'denied'] },
      invoice_number:     { label: 'Invoice #',       sql: 'i.invoice_number',        type: 'text' },
      created_at:         { label: 'Date',            sql: 'd.created_at',           type: 'date' },
    },
    defaultColumns: ['fund_name', 'contact_name', 'amount', 'payment_status', 'method', 'created_at'],
    defaultSort: { field: 'created_at', dir: 'desc' },
  },

  pledges: {
    label: 'Pledges',
    // A pledge is a recurring_invoices row with fund_id set — see
    // server/src/routes/pledges.js's header comment for why this isn't a
    // separate table.
    table: 'recurring_invoices', alias: 'ri',
    joins: [
      { table: 'funds',                  alias: 'f',  on: 'f.id = ri.fund_id' },
      { table: 'contacts',               alias: 'c',  on: 'c.id = ri.contact_id' },
      { table: 'organizations',          alias: 'org', on: 'org.id = ri.organization_id' },
      { table: 'recurring_invoice_items', alias: 'it', on: 'it.recurring_invoice_id = ri.id' },
    ],
    scope: (scopeIds) => {
      const ownerClause = require('./scope').contactOwnerClause(scopeIds, 'ri.contact_id');
      return ownerClause ? `ri.fund_id IS NOT NULL AND (${ownerClause})` : 'ri.fund_id IS NOT NULL';
    },
    columns: {
      fund_name:          {
        label: 'Fund', sql: 'f.name', type: 'enum',
        dynamicOptions: async () => {
          const { db } = require('../db');
          const [rows] = await db.query('SELECT name FROM funds WHERE is_active = 1 ORDER BY name');
          return rows.map((r) => r.name);
        },
      },
      contact_name:       { label: 'Donor',           sql: "TRIM(CONCAT_WS(' ', c.first_name, c.last_name))", type: 'text' },
      organization_name:  { label: 'Organization',    sql: 'org.name',               type: 'text' },
      amount_per_installment: { label: 'Installment Amount', sql: 'it.unit_price',   type: 'currency' },
      max_occurrences:    { label: 'Total Installments', sql: 'ri.max_occurrences',  type: 'number' },
      occurrences_run:    { label: 'Installments Collected', sql: 'ri.occurrences_run', type: 'number' },
      status:             { label: 'Status',          sql: 'ri.status',              type: 'enum', options: ['active', 'paused', 'completed', 'canceled'] },
      interval_unit:      { label: 'Interval',         sql: 'ri.interval_unit',       type: 'enum', options: ['week', 'month', 'year'] },
      next_run_date:      { label: 'Next Installment', sql: 'ri.next_run_date',      type: 'date' },
      start_date:         { label: 'Start Date',       sql: 'ri.start_date',         type: 'date' },
      created_at:         { label: 'Created',          sql: 'ri.created_at',         type: 'date' },
    },
    defaultColumns: ['fund_name', 'contact_name', 'amount_per_installment', 'occurrences_run', 'max_occurrences', 'status'],
    defaultSort: { field: 'next_run_date', dir: 'asc' },
  },

  volunteer_hours: {
    label: 'Volunteer Hours',
    table: 'event_volunteer_assignments', alias: 'eva',
    joins: [
      { table: 'contacts', alias: 'c', on: 'c.id = eva.contact_id' },
      { table: 'events',   alias: 'e', on: 'e.id = eva.event_id' },
    ],
    scope: (scopeIds) => require('./scope').contactOwnerClause(scopeIds, 'eva.contact_id'),
    columns: {
      contact_name:   { label: 'Volunteer',        sql: "TRIM(CONCAT_WS(' ', c.first_name, c.last_name))", type: 'text' },
      event_name:     { label: 'Event',            sql: 'e.name',                type: 'text' },
      role:           { label: 'Role',             sql: 'eva.role',              type: 'text' },
      shift_start:    { label: 'Shift Start',      sql: 'eva.shift_start',       type: 'date' },
      shift_end:      { label: 'Shift End',        sql: 'eva.shift_end',         type: 'date' },
      checked_in_at:  { label: 'Checked In',       sql: 'eva.checked_in_at',     type: 'date' },
      checked_out_at: { label: 'Checked Out',      sql: 'eva.checked_out_at',    type: 'date' },
      actual_hours:   { label: 'Actual Hours',     sql: 'eva.actual_hours',      type: 'number' },
      hours_approved: { label: 'Hours Approved',   sql: "IF(eva.hours_approved_at IS NOT NULL, 'Yes', 'No')", type: 'enum', options: ['Yes', 'No'] },
      status:         { label: 'Status',           sql: 'eva.status',            type: 'enum', options: ['invited', 'confirmed', 'declined', 'completed'] },
    },
    defaultColumns: ['contact_name', 'event_name', 'role', 'actual_hours', 'hours_approved', 'status'],
    defaultSort: { field: 'shift_start', dir: 'desc' },
  },

  members: {
    label: 'Members',
    table: 'subscriptions', alias: 's',
    joins: [
      { table: 'membership_tiers', alias: 'mt', on: 'mt.id = s.membership_tier_id' },
      { table: 'contacts',         alias: 'c',  on: 'c.id = s.contact_id' },
      { table: 'organizations',    alias: 'org', on: 'org.id = s.organization_id' },
    ],
    scope: (scopeIds) => {
      const ownerClause = require('./scope').contactOwnerClause(scopeIds, 's.contact_id');
      return ownerClause ? `s.membership_tier_id IS NOT NULL AND (${ownerClause})` : 's.membership_tier_id IS NOT NULL';
    },
    columns: {
      contact_name:      { label: 'Member',          sql: "TRIM(CONCAT_WS(' ', c.first_name, c.last_name))", type: 'text' },
      member_email:      { label: 'Email',           sql: 'c.email',             type: 'text' },
      organization_name: { label: 'Organization',    sql: 'org.name',            type: 'text' },
      tier_name:         { label: 'Membership Tier', sql: 'mt.name',             type: 'text' },
      tier_price:        { label: 'Tier Price',      sql: 'mt.price',            type: 'currency' },
      status:            { label: 'Status',          sql: 's.status',            type: 'enum', options: ['active', 'paused', 'canceled', 'completed'] },
      interval_unit:     { label: 'Billing Interval', sql: 's.interval_unit',    type: 'enum', options: ['day', 'week', 'month', 'year'] },
      start_date:        { label: 'Start Date',      sql: 's.start_date',        type: 'date' },
      next_run_date:     { label: 'Next Run',        sql: 's.next_run_date',     type: 'date' },
      end_date:          { label: 'End Date',        sql: 's.end_date',          type: 'date' },
      created_at:        { label: 'Created',         sql: 's.created_at',        type: 'date' },
    },
    defaultColumns: ['contact_name', 'tier_name', 'status', 'tier_price', 'next_run_date'],
    defaultSort: { field: 'created_at', dir: 'desc' },
  },

  event_registrations: {
    label: 'Event Registrations',
    table: 'event_registrations', alias: 'r',
    joins: [
      { table: 'events',             alias: 'e',   on: 'e.id = r.event_id' },
      { table: 'event_ticket_types', alias: 'tt',  on: 'tt.id = r.ticket_type_id' },
      { table: 'contacts',           alias: 'c',   on: 'c.id = r.contact_id' },
      { table: 'invoices',          alias: 'i',   on: 'i.id = r.invoice_id' },
      { table: 'payments',          alias: 'p',   on: 'p.id = r.payment_id' },
    ],
    scope: (scopeIds) => require('./scope').contactOwnerClause(scopeIds, 'r.contact_id'),
    columns: {
      event_name:      { label: 'Event',           sql: 'e.name',                 type: 'text' },
      ticket_type:     { label: 'Ticket Type',     sql: 'tt.name',                type: 'text' },
      contact_name:    { label: 'Contact',         sql: "TRIM(CONCAT_WS(' ', c.first_name, c.last_name))", type: 'text' },
      attendee_name:   { label: 'Attendee Name',   sql: 'r.attendee_name',        type: 'text' },
      attendee_email:  { label: 'Attendee Email',  sql: 'r.attendee_email',       type: 'text' },
      quantity:        { label: 'Quantity',        sql: 'r.quantity',             type: 'number' },
      status:          { label: 'Status',          sql: 'r.status',               type: 'enum', options: ['registered', 'cancelled', 'waitlisted'] },
      amount:          { label: 'Amount',           sql: "(tt.price * r.quantity)", type: 'currency' },
      payment_status:  { label: 'Payment Status',  sql: 'p.status',               type: 'enum', options: ['pending', 'authorized', 'captured', 'failed', 'refunded', 'voided'] },
      invoice_number:  { label: 'Invoice #',        sql: 'i.invoice_number',       type: 'text' },
      event_start_at:  { label: 'Event Date',       sql: 'e.start_at',             type: 'date' },
      created_at:      { label: 'Registered',       sql: 'r.created_at',           type: 'date' },
    },
    defaultColumns: ['event_name', 'attendee_name', 'ticket_type', 'quantity', 'amount', 'status', 'created_at'],
    defaultSort: { field: 'created_at', dir: 'desc' },
  },
};

const OPERATORS_BY_TYPE = {
  text:     ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty'],
  number:   ['equals', 'not_equals', 'greater_than', 'less_than', 'between', 'is_empty', 'is_not_empty'],
  currency: ['equals', 'not_equals', 'greater_than', 'less_than', 'between', 'is_empty', 'is_not_empty'],
  date:     ['equals', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
  enum:     ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
};

function getModule(key) {
  const mod = MODULES[key];
  if (!mod) throw Object.assign(new Error(`Unknown report module: ${key}`), { status: 400 });
  return mod;
}

// Metadata payload for the client — no functions, just the shape it needs to render.
function publicRegistry() {
  const out = {};
  for (const [key, mod] of Object.entries(MODULES)) {
    out[key] = {
      label: mod.label,
      defaultColumns: mod.defaultColumns,
      defaultSort: mod.defaultSort,
      columns: Object.fromEntries(
        Object.entries(mod.columns).map(([colKey, col]) => [
          colKey,
          {
            label: col.label, type: col.type, options: col.options || null,
            dynamicOptions: !!col.dynamicOptions, operators: OPERATORS_BY_TYPE[col.type],
          },
        ]),
      ),
    };
  }
  return out;
}

// Resolves the live option list for an enum column whose values come from a
// table (e.g. active funds) rather than a fixed set — the column's own
// `dynamicOptions()` resolver does the query. Falls back to any static
// `options` array for columns that don't define one, so callers don't need
// to branch.
async function getDynamicOptions(moduleKey, columnKey) {
  const mod = getModule(moduleKey);
  const col = mod.columns[columnKey];
  if (!col) throw Object.assign(new Error(`Unknown field: ${columnKey}`), { status: 400 });
  if (col.dynamicOptions) return col.dynamicOptions();
  return col.options || [];
}

module.exports = { MODULES, OPERATORS_BY_TYPE, getModule, publicRegistry, getDynamicOptions };
