-- =============================================================================
-- kingdom-connections — minimal seed data for a fresh local install
--
-- Loads only what the app needs to boot and log in: RBAC (roles/permissions),
-- a placeholder business profile (edit via Settings > Business after login),
-- and one default admin user. No contacts/donations/deals/etc. — this is
-- structural seed data, not sample content.
--
-- Run after db/schema.sql, e.g.:
--   mysql -u root kingdom_connections < db/schema.sql
--   mysql -u root kingdom_connections < db/seed.sql
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- RBAC — roles, permissions, and the role -> permission grants the app
-- expects to exist (referenced by key in server/src/middleware/auth.js and
-- throughout the route layer's requirePermission() checks).
-- ---------------------------------------------------------------------------
INSERT INTO `roles` (`id`, `name`, `description`, `is_system`, `created_at`) VALUES
  (1,'admin','Full access',1,NOW()),
  (2,'manager','Sales manager',1,NOW()),
  (3,'sales','Sales rep',1,NOW()),
  (4,'readonly','Read-only access',1,NOW()),
  (5,'portal','Customer portal user — read-only own records',1,NOW());

INSERT INTO `permissions` (`id`, `key`, `description`, `module_key`) VALUES
  (1,'contacts.read','View contacts',NULL),
  (2,'contacts.write','Create / edit contacts',NULL),
  (3,'contacts.delete','Delete contacts',NULL),
  (4,'organizations.read','View organizations',NULL),
  (5,'organizations.write','Create / edit organizations',NULL),
  (6,'organizations.delete','Delete organizations',NULL),
  (7,'deals.read','View deals',NULL),
  (8,'deals.write','Create / edit deals',NULL),
  (9,'deals.delete','Delete deals',NULL),
  (10,'pipelines.manage','Manage pipelines & stages',NULL),
  (11,'tasks.read','View tasks',NULL),
  (12,'tasks.write','Create / edit tasks',NULL),
  (13,'notes.write','Write notes',NULL),
  (14,'reports.view','View reports',NULL),
  (15,'import.csv','Import CSV',NULL),
  (16,'users.manage','Manage users',NULL),
  (17,'roles.manage','Manage roles',NULL),
  (18,'settings.manage','Manage settings (SMTP / CW Manage)',NULL),
  (19,'cw.push','Push to ConnectWise Manage',NULL),
  (20,'invoices.read','View invoices',NULL),
  (21,'invoices.write','Create / edit invoices',NULL),
  (22,'invoices.delete','Delete / void invoices',NULL),
  (23,'invoices.send','Send invoices to customers',NULL),
  (24,'payments.read','View payments',NULL),
  (25,'payments.write','Record / refund payments',NULL),
  (26,'subscriptions.read','View subscriptions',NULL),
  (27,'subscriptions.write','Create / manage subscriptions',NULL),
  (28,'portal.manage','Manage customer portal users',NULL),
  (29,'maps.view','View map / territory',NULL),
  (30,'notes.read','View notes',NULL);

INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
  (1,1),(2,1),(3,1),(4,1),(1,2),(2,2),(3,2),(1,3),(2,3),(1,4),(2,4),(3,4),(4,4),
  (1,5),(2,5),(3,5),(1,6),(2,6),(1,7),(2,7),(3,7),(4,7),(1,8),(2,8),(3,8),(1,9),
  (2,9),(1,10),(2,10),(1,11),(2,11),(3,11),(4,11),(1,12),(2,12),(3,12),(1,13),
  (2,13),(3,13),(1,14),(2,14),(3,14),(4,14),(1,15),(2,15),(3,15),(1,16),(1,17),
  (1,18),(1,19),(2,19),(1,20),(2,20),(3,20),(4,20),(5,20),(1,21),(2,21),(3,21),
  (1,22),(2,22),(1,23),(2,23),(3,23),(1,24),(2,24),(3,24),(4,24),(5,24),(1,25),
  (2,25),(1,26),(2,26),(3,26),(4,26),(5,26),(1,27),(2,27),(1,28),(1,29),(2,29),
  (3,29),(4,29),(1,30),(2,30),(3,30),(4,30);

-- ---------------------------------------------------------------------------
-- Placeholder business profile (id=1 — the app assumes a single-row table).
-- Replace via Settings > Business once logged in: name, address, logo,
-- brand colors, tax EIN, etc. all live here and drive branding across the
-- app, emails, and PDF receipts/statements.
-- ---------------------------------------------------------------------------
INSERT INTO `business_settings`
  (`id`, `business_name`, `address`, `city`, `state`, `zip`, `country`, `phone`, `email`, `website`)
VALUES
  (1, 'Your Organization', '', '', '', '', '', '', '', '');

-- ---------------------------------------------------------------------------
-- Default admin login — CHANGE THIS PASSWORD after first login.
--   email:    admin@localcrm.local
--   password: ChangeMe123!
-- ---------------------------------------------------------------------------
INSERT INTO `users` (`id`, `email`, `password_hash`, `first_name`, `last_name`, `is_active`)
VALUES
  (1, 'admin@localcrm.local', '$2a$12$3FpyqzBm2SLDn5J1t6MXoupvq0DSCQmVwYetOFIJsaA4DIZ3MPdha', 'Local', 'Admin', 1);

INSERT INTO `user_roles` (`user_id`, `role_id`) VALUES (1, 1);

SET FOREIGN_KEY_CHECKS = 1;
