import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import NotFound from './admin/pages/NotFound.jsx';
import AiKnowledgeBasePage from './admin/pages/AiKnowledgeBasePage.jsx';
import AppLayout from './admin/components/AppLayout.jsx';
import Login from './admin/pages/Login.jsx';
import ResetPassword from './admin/pages/ResetPassword.jsx';
import Dashboard from './admin/pages/Dashboard.jsx';
import ContactsList from './admin/pages/ContactsList.jsx';
import ContactDetail from './admin/pages/ContactDetail.jsx';
import OrganizationsList from './admin/pages/OrganizationsList.jsx';
import DuplicatesPage from './admin/pages/DuplicatesPage.jsx';
import OrganizationDetail from './admin/pages/OrganizationDetail.jsx';
import DealsList from './admin/pages/DealsList.jsx';
import DealDetail from './admin/pages/DealDetail.jsx';
import Pipeline from './admin/pages/Pipeline.jsx';
import TasksPage from './admin/pages/TasksPage.jsx';
import ActivitiesPage from './admin/pages/ActivitiesPage.jsx';
import UsersPage from './admin/pages/UsersPage.jsx';
import RolesPage from './admin/pages/RolesPage.jsx';
import CsvImportPage from './admin/pages/CsvImportPage.jsx';
import SettingsPage from './admin/pages/SettingsPage.jsx';
import TagsPage from './admin/pages/TagsPage.jsx';
import CustomFieldsPage from './admin/pages/CustomFieldsPage.jsx';
import PipelinesPage from './admin/pages/PipelinesPage.jsx';
import PortalAdminPage from './admin/pages/PortalAdminPage.jsx';
import AcceptInvite from './admin/pages/AcceptInvite.jsx';
import InvoicesList from './admin/pages/InvoicesList.jsx';
import InvoiceDetail from './admin/pages/InvoiceDetail.jsx';
import PayInvoice from './admin/pages/PayInvoice.jsx';
import TransactionsPage from './admin/pages/TransactionsPage.jsx';
import SubscriptionsList from './admin/pages/SubscriptionsList.jsx';
import SubscriptionDetail from './admin/pages/SubscriptionDetail.jsx';
import DonationsList from './admin/pages/DonationsList.jsx';
import FundsList from './admin/pages/FundsList.jsx';
import TextToGiveSettingsPage from './admin/pages/TextToGiveSettingsPage.jsx';
import MembersList from './admin/pages/MembersList.jsx';
import MembershipTiersList from './admin/pages/MembershipTiersList.jsx';
import EventsList from './admin/pages/EventsList.jsx';
import EventDetail from './admin/pages/EventDetail.jsx';
import EventCheckIn from './admin/pages/EventCheckIn.jsx';
import EventsCalendar from './admin/pages/EventsCalendar.jsx';
import EventCheckinScanner from './frontend/pages/EventCheckinScanner.jsx';
import VolunteerCheckinScanner from './frontend/pages/VolunteerCheckinScanner.jsx';
import VolunteerBadge from './frontend/pages/VolunteerBadge.jsx';
import VolunteersList from './admin/pages/VolunteersList.jsx';
import VolunteerDetail from './admin/pages/VolunteerDetail.jsx';
import RecurringInvoicesList from './admin/pages/RecurringInvoicesList.jsx';
import RecurringInvoiceDetail from './admin/pages/RecurringInvoiceDetail.jsx';
import PledgesList from './admin/pages/PledgesList.jsx';
import DonorRetentionReport from './admin/pages/DonorRetentionReport.jsx';
import PledgeDetail from './admin/pages/PledgeDetail.jsx';
import MapsPage from './admin/pages/MapsPage.jsx';
import CommsInboxPage from './admin/pages/CommsInboxPage.jsx';
import TemplatesPage from './admin/pages/TemplatesPage.jsx';
import ListsPage from './admin/pages/ListsPage.jsx';
import CampaignsPage from './admin/pages/CampaignsPage.jsx';
import CampaignComposer from './admin/pages/CampaignComposer.jsx';
import CampaignDetail from './admin/pages/CampaignDetail.jsx';
import AutomationsPage from './admin/pages/AutomationsPage.jsx';
import AutomationBuilder from './admin/pages/AutomationBuilder.jsx';
import BusinessSettings from './admin/pages/BusinessSettings.jsx';
import BillingTaxReport from './admin/pages/BillingTaxReport.jsx';
import BillingReconciliationReport from './admin/pages/BillingReconciliationReport.jsx';
import PortalLayout from './admin/components/PortalLayout.jsx';
import PortalLogin from './admin/pages/portal/PortalLogin.jsx';
import PortalDashboard from './admin/pages/portal/PortalDashboard.jsx';
import PortalInvoices from './admin/pages/portal/PortalInvoices.jsx';
import PortalInvoiceView from './admin/pages/portal/PortalInvoiceView.jsx';
import PortalSubscriptions from './admin/pages/portal/PortalSubscriptions.jsx';
import PortalPaymentMethods from './admin/pages/portal/PortalPaymentMethods.jsx';
import PortalProfile from './admin/pages/portal/PortalProfile.jsx';
import PortalResetPassword from './admin/pages/portal/PortalResetPassword.jsx';
import PortalRegister from './admin/pages/portal/PortalRegister.jsx';
import PortalVerifyEmail from './admin/pages/portal/PortalVerifyEmail.jsx';
import PortalGiving from './admin/pages/portal/PortalGiving.jsx';
import PortalMembership from './admin/pages/portal/PortalMembership.jsx';
import PortalEvents from './admin/pages/portal/PortalEvents.jsx';
import PortalOrders from './admin/pages/portal/PortalOrders.jsx';
import WebsitePagesPage from './vb/admin/WebsitePagesPage.jsx';
import WebsitePageEditor from './builder/editor/BuilderPage.jsx';
import WebsiteHeaderFooterPage from './vb/admin/WebsiteHeaderFooterPage.jsx';
import WebsiteGlobalSettingsPage from './vb/admin/WebsiteGlobalSettingsPage.jsx';
import BlogAdminPage from './admin/pages/BlogAdminPage.jsx';
import BlogPostEditor from './admin/pages/BlogPostEditor.jsx';
import MediaLibraryPage from './admin/pages/MediaLibraryPage.jsx';
import SeoSettingsPage from './admin/pages/SeoSettingsPage.jsx';
import DnsManager from './admin/pages/DnsManager.jsx';
import SocialAccountsPage from './admin/pages/SocialAccountsPage.jsx';
import SocialComposerPage from './admin/pages/SocialComposerPage.jsx';
import PostQueuePage from './admin/pages/PostQueuePage.jsx';
import ReportsDashboardPage from './admin/pages/ReportsDashboardPage.jsx';
import ReportBuilderPage from './admin/pages/ReportBuilderPage.jsx';
import FormsPage from './admin/pages/FormsPage.jsx';
import FormBuilder from './admin/pages/FormBuilder.jsx';
import FormSubmissionsPage from './admin/pages/FormSubmissionsPage.jsx';
import PublicLayout from './components/PublicLayout.jsx';
import WebsitePublicPage from './frontend/pages/WebsitePublicPage.jsx';
import BlogPage from './frontend/pages/BlogPage.jsx';
import BlogPostPage from './frontend/pages/BlogPostPage.jsx';
import SearchResultsPage from './frontend/pages/SearchResultsPage.jsx';
import ProductsList from './admin/pages/ProductsList.jsx';
import ProductForm from './admin/pages/ProductForm.jsx';
import CategoriesPage from './admin/pages/CategoriesPage.jsx';
import OrdersList from './admin/pages/OrdersList.jsx';
import OrderDetail from './admin/pages/OrderDetail.jsx';
import ShippingPage from './admin/pages/ShippingPage.jsx';
import TaxPage from './admin/pages/TaxPage.jsx';
import ProcessingFeesPage from './admin/pages/ProcessingFeesPage.jsx';
import ShopPage from './frontend/pages/ShopPage.jsx';
import ProductPage from './frontend/pages/ProductPage.jsx';
import EventsPage from './frontend/pages/EventsPage.jsx';
import EventPage from './frontend/pages/EventPage.jsx';
import CartPage from './frontend/pages/CartPage.jsx';
import CheckoutPage from './frontend/pages/CheckoutPage.jsx';
import OrderConfirmationPage from './frontend/pages/OrderConfirmationPage.jsx';

function Protected({ children, redirectTo = '/login', blockPortal = false }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) {
    return <Navigate to={redirectTo} replace />;
  }
  // Portal (customer) users have their own app tree at /portal/* — never let
  // them into the admin shell, regardless of which permissions their role
  // happens to share with admin routes (e.g. invoices.read).
  if (blockPortal && user.roles?.includes('portal')) {
    return <Navigate to="/portal/dashboard" replace />;
  }
  return children;
}

// Gate a route behind a permission — redirects to /admin/dashboard if not
// allowed. Admin role always passes through.
function PermissionRoute({ perm, children }) {
  const { can } = useAuth();
  if (!can(perm)) return <Navigate to="/admin/dashboard" replace />;
  return children;
}

// The admin app used to live at "/", so old bookmarks/links to bare
// top-level segments (e.g. /contacts, /invoices) need to keep working after
// the move to /admin/*. Preserves the sub-path and query string.
function LegacyAdminRedirect() {
  const location = useLocation();
  return <Navigate to={`/admin${location.pathname}${location.search}`} replace />;
}
// Every top-level admin segment that did NOT already start with "admin/"
// (those — admin/tags, admin/products, etc. — keep the exact same URL under
// the new /admin parent, so they need no redirect at all).
const LEGACY_ADMIN_SEGMENTS = [
  'dashboard', 'contacts', 'organizations', 'duplicates', 'deals', 'pipeline',
  'tasks', 'activities', 'invoices', 'transactions', 'billing', 'subscriptions',
  'donations', 'membership', 'events', 'volunteers', 'recurring-invoices',
  'pledges', 'maps', 'comms', 'import', 'users', 'roles', 'settings',
  'website', 'blog-posts', 'media', 'reports', 'marketing', 'forms',
];

export default function App() {
  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/pay/:token" element={<PayInvoice />} />
      <Route path="/events-checkin/:eventId" element={<EventCheckinScanner />} />
      <Route path="/volunteer-checkin/:eventId" element={<VolunteerCheckinScanner />} />
      <Route path="/volunteer-badge/:qrToken" element={<VolunteerBadge />} />
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal/register" element={<PortalRegister />} />
      <Route path="/portal/verify-email" element={<PortalVerifyEmail />} />
      <Route path="/portal/reset-password" element={<PortalResetPassword />} />
      {/* Standalone builder — no dashboard chrome, opened via the "Window" button
          for a fullscreen editing experience (same component, no .topbar in the DOM). */}
      <Route path="/builder/:id" element={<Protected blockPortal><PermissionRoute perm="settings.manage"><WebsitePageEditor /></PermissionRoute></Protected>} />

      <Route path="/portal" element={<Protected redirectTo="/portal/login"><PortalLayout /></Protected>}>
        <Route index                     element={<Navigate to="/portal/dashboard" replace />} />
        <Route path="dashboard"          element={<PortalDashboard />} />
        <Route path="giving"             element={<PortalGiving />} />
        <Route path="membership"         element={<PortalMembership />} />
        <Route path="events"             element={<PortalEvents />} />
        <Route path="orders"             element={<PortalOrders />} />
        <Route path="invoices"           element={<PortalInvoices />} />
        <Route path="invoices/:id"       element={<PortalInvoiceView />} />
        <Route path="subscriptions"      element={<PortalSubscriptions />} />
        <Route path="payment-methods"    element={<PortalPaymentMethods />} />
        <Route path="profile"            element={<PortalProfile />} />
      </Route>

      <Route path="/admin" element={
        <Protected blockPortal><AppLayout /></Protected>
      }>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard"          element={<Dashboard />} />

        <Route path="contacts"           element={<PermissionRoute perm="contacts.read"><ContactsList /></PermissionRoute>} />
        <Route path="contacts/:id"       element={<PermissionRoute perm="contacts.read"><ContactDetail /></PermissionRoute>} />

        <Route path="organizations"      element={<PermissionRoute perm="organizations.read"><OrganizationsList /></PermissionRoute>} />
        <Route path="organizations/:id"  element={<PermissionRoute perm="organizations.read"><OrganizationDetail /></PermissionRoute>} />
        <Route path="duplicates"         element={<PermissionRoute perm="contacts.write"><DuplicatesPage /></PermissionRoute>} />

        <Route path="deals"              element={<PermissionRoute perm="deals.read"><DealsList /></PermissionRoute>} />
        <Route path="deals/:id"          element={<PermissionRoute perm="deals.read"><DealDetail /></PermissionRoute>} />
        <Route path="pipeline"           element={<PermissionRoute perm="deals.read"><Pipeline /></PermissionRoute>} />

        <Route path="tasks"              element={<PermissionRoute perm="tasks.read"><TasksPage /></PermissionRoute>} />
        <Route path="activities"         element={<ActivitiesPage />} />

        <Route path="invoices"           element={<PermissionRoute perm="invoices.read"><InvoicesList /></PermissionRoute>} />
        <Route path="invoices/:id"       element={<PermissionRoute perm="invoices.read"><InvoiceDetail /></PermissionRoute>} />
        <Route path="transactions"       element={<PermissionRoute perm="payments.read"><TransactionsPage /></PermissionRoute>} />
        <Route path="billing/tax-report"        element={<PermissionRoute perm="reports.view"><BillingTaxReport /></PermissionRoute>} />
        <Route path="billing/reconciliation"    element={<PermissionRoute perm="reports.view"><BillingReconciliationReport /></PermissionRoute>} />

        <Route path="subscriptions"             element={<PermissionRoute perm="subscriptions.read"><SubscriptionsList /></PermissionRoute>} />
        <Route path="subscriptions/:id"         element={<PermissionRoute perm="subscriptions.read"><SubscriptionDetail /></PermissionRoute>} />

        <Route path="donations"                 element={<PermissionRoute perm="donations.read"><DonationsList /></PermissionRoute>} />
        <Route path="donations/funds"           element={<PermissionRoute perm="donations.read"><FundsList /></PermissionRoute>} />
        <Route path="donations/text-to-give"    element={<PermissionRoute perm="settings.manage"><TextToGiveSettingsPage /></PermissionRoute>} />
        <Route path="donations/retention"       element={<PermissionRoute perm="reports.view"><DonorRetentionReport /></PermissionRoute>} />

        <Route path="membership"                element={<PermissionRoute perm="membership.read"><MembersList /></PermissionRoute>} />
        <Route path="membership/tiers"          element={<PermissionRoute perm="membership.read"><MembershipTiersList /></PermissionRoute>} />

        <Route path="events"                    element={<PermissionRoute perm="events.read"><EventsList /></PermissionRoute>} />
        <Route path="events/calendar"           element={<PermissionRoute perm="events.read"><EventsCalendar /></PermissionRoute>} />
        <Route path="events/:id"                element={<PermissionRoute perm="events.read"><EventDetail /></PermissionRoute>} />
        <Route path="events/:id/checkin"        element={<PermissionRoute perm="events.checkin"><EventCheckIn /></PermissionRoute>} />
        <Route path="volunteers"                element={<PermissionRoute perm="volunteers.read"><VolunteersList /></PermissionRoute>} />
        <Route path="volunteers/:contactId"     element={<PermissionRoute perm="volunteers.read"><VolunteerDetail /></PermissionRoute>} />

        <Route path="recurring-invoices"        element={<PermissionRoute perm="invoices.read"><RecurringInvoicesList /></PermissionRoute>} />
        <Route path="recurring-invoices/:id"    element={<PermissionRoute perm="invoices.read"><RecurringInvoiceDetail /></PermissionRoute>} />
        <Route path="pledges"                   element={<PermissionRoute perm="donations.read"><PledgesList /></PermissionRoute>} />
        <Route path="pledges/:id"               element={<PermissionRoute perm="donations.read"><PledgeDetail /></PermissionRoute>} />

        <Route path="maps"               element={<PermissionRoute perm="maps.view"><MapsPage /></PermissionRoute>} />

        <Route path="comms"              element={<PermissionRoute perm="comms.read"><CommsInboxPage /></PermissionRoute>} />
        <Route path="comms/templates"    element={<PermissionRoute perm="comms.templates.manage"><TemplatesPage /></PermissionRoute>} />
        <Route path="comms/lists"        element={<PermissionRoute perm="lists.read"><ListsPage /></PermissionRoute>} />
        <Route path="comms/campaigns"          element={<PermissionRoute perm="campaigns.read"><CampaignsPage /></PermissionRoute>} />
        <Route path="comms/campaigns/new"      element={<PermissionRoute perm="campaigns.write"><CampaignComposer /></PermissionRoute>} />
        <Route path="comms/campaigns/:id"      element={<PermissionRoute perm="campaigns.read"><CampaignDetail /></PermissionRoute>} />
        <Route path="comms/campaigns/:id/edit" element={<PermissionRoute perm="campaigns.write"><CampaignComposer /></PermissionRoute>} />

        <Route path="comms/automations"      element={<PermissionRoute perm="automations.read"><AutomationsPage /></PermissionRoute>} />
        <Route path="comms/automations/new"  element={<PermissionRoute perm="automations.write"><AutomationBuilder /></PermissionRoute>} />
        <Route path="comms/automations/:id"  element={<PermissionRoute perm="automations.write"><AutomationBuilder /></PermissionRoute>} />

        <Route path="import"             element={<PermissionRoute perm="import.csv"><CsvImportPage /></PermissionRoute>} />

        <Route path="users"              element={<PermissionRoute perm="users.manage"><UsersPage /></PermissionRoute>} />
        <Route path="roles"              element={<PermissionRoute perm="roles.manage"><RolesPage /></PermissionRoute>} />
        <Route path="settings"                   element={<PermissionRoute perm="settings.manage"><SettingsPage /></PermissionRoute>} />
        <Route path="settings/business"          element={<PermissionRoute perm="settings.manage"><BusinessSettings /></PermissionRoute>} />
        <Route path="tags"          element={<PermissionRoute perm="settings.manage"><TagsPage /></PermissionRoute>} />
        <Route path="custom-fields" element={<PermissionRoute perm="settings.manage"><CustomFieldsPage /></PermissionRoute>} />
        <Route path="pipelines"     element={<PermissionRoute perm="pipelines.access"><PipelinesPage /></PermissionRoute>} />
        <Route path="portal"        element={<PermissionRoute perm="portal.manage"><PortalAdminPage /></PermissionRoute>} />
        <Route path="ai-kb"         element={<PermissionRoute perm="settings.manage"><AiKnowledgeBasePage /></PermissionRoute>} />

        {/*
          Route paths below match what these pages actually hardcode in
          their own navigate()/Link calls (verified by grepping each file),
          NOT the paths the install prompt suggested — several of those
          didn't match the real component code (e.g. blog admin navigates
          to /blog-posts/*, not /blog/*; social pages cross-link via
          /marketing/*, not /social/*; SEO settings links from the reports
          dashboard point at /reports/seo-settings, not /seo).
        */}
        <Route path="website/pages"          element={<PermissionRoute perm="settings.manage"><WebsitePagesPage /></PermissionRoute>} />
        <Route path="website/pages/:id/edit" element={<PermissionRoute perm="settings.manage"><WebsitePageEditor /></PermissionRoute>} />
        <Route path="website/settings"       element={<PermissionRoute perm="settings.manage"><WebsiteHeaderFooterPage /></PermissionRoute>} />
        <Route path="website/global-settings" element={<PermissionRoute perm="settings.manage"><WebsiteGlobalSettingsPage /></PermissionRoute>} />
        {/* Admin blog management — the public, SEO-facing blog is the
            top-level /blog in the PublicLayout tree below; these are
            already distinct paths (blog-posts vs blog), no collision. */}
        <Route path="blog-posts"             element={<PermissionRoute perm="settings.manage"><BlogAdminPage /></PermissionRoute>} />
        <Route path="blog-posts/new"         element={<PermissionRoute perm="settings.manage"><BlogPostEditor /></PermissionRoute>} />
        <Route path="blog-posts/:id/edit"    element={<PermissionRoute perm="settings.manage"><BlogPostEditor /></PermissionRoute>} />
        <Route path="media"                  element={<PermissionRoute perm="settings.manage"><MediaLibraryPage /></PermissionRoute>} />
        <Route path="reports/seo-settings"   element={<PermissionRoute perm="settings.manage"><SeoSettingsPage /></PermissionRoute>} />
        <Route path="settings/dns"           element={<PermissionRoute perm="settings.manage"><DnsManager /></PermissionRoute>} />
        <Route path="marketing/accounts"          element={<PermissionRoute perm="settings.manage"><SocialAccountsPage /></PermissionRoute>} />
        <Route path="marketing/social-composer"   element={<PermissionRoute perm="campaigns.write"><SocialComposerPage /></PermissionRoute>} />
        <Route path="marketing/post-queue"        element={<PermissionRoute perm="campaigns.read"><PostQueuePage /></PermissionRoute>} />
        <Route path="reports/builder"         element={<PermissionRoute perm="reports.view"><ReportBuilderPage /></PermissionRoute>} />
        <Route path="reports/*"              element={<PermissionRoute perm="reports.view"><ReportsDashboardPage /></PermissionRoute>} />
        <Route path="forms"                  element={<PermissionRoute perm="settings.manage"><FormsPage /></PermissionRoute>} />
        <Route path="forms/new"              element={<PermissionRoute perm="settings.manage"><FormBuilder /></PermissionRoute>} />
        <Route path="forms/:id/edit"         element={<PermissionRoute perm="settings.manage"><FormBuilder /></PermissionRoute>} />
        <Route path="forms/:id/submissions"  element={<PermissionRoute perm="settings.manage"><FormSubmissionsPage /></PermissionRoute>} />

        <Route path="products"          element={<PermissionRoute perm="products.read"><ProductsList /></PermissionRoute>} />
        <Route path="products/new"      element={<PermissionRoute perm="products.write"><ProductForm /></PermissionRoute>} />
        <Route path="products/:id"      element={<PermissionRoute perm="products.write"><ProductForm /></PermissionRoute>} />
        <Route path="categories"        element={<PermissionRoute perm="products.read"><CategoriesPage /></PermissionRoute>} />
        <Route path="orders"            element={<PermissionRoute perm="orders.read"><OrdersList /></PermissionRoute>} />
        <Route path="orders/:id"        element={<PermissionRoute perm="orders.read"><OrderDetail /></PermissionRoute>} />
        <Route path="shipping"          element={<PermissionRoute perm="shipping.manage"><ShippingPage /></PermissionRoute>} />
        <Route path="tax"               element={<PermissionRoute perm="tax.manage"><TaxPage /></PermissionRoute>} />
        <Route path="processing-fees"   element={<PermissionRoute perm="commerce.settings"><ProcessingFeesPage /></PermissionRoute>} />
      </Route>

      <Route element={<PublicLayout />}>
        <Route path="/"           element={<WebsitePublicPage slug="home" />} />
        <Route path="/home"       element={<Navigate to="/" replace />} />
        <Route path="/p/:slug"    element={<WebsitePublicPage />} />
        <Route path="/services"   element={<WebsitePublicPage slug="services" />} />
        <Route path="/about"      element={<WebsitePublicPage slug="about" />} />
        <Route path="/faq"        element={<WebsitePublicPage slug="faq" />} />
        <Route path="/contact"    element={<WebsitePublicPage slug="contact" />} />
        <Route path="/blog"       element={<BlogPage />} />
        <Route path="/blog/:slug" element={<BlogPostPage />} />
        <Route path="/search"     element={<SearchResultsPage />} />
        <Route path="/shop"       element={<ShopPage />} />
        <Route path="/shop/:slug" element={<ProductPage />} />
        <Route path="/events"       element={<EventsPage />} />
        <Route path="/events/:slug" element={<EventPage />} />
        <Route path="/cart"       element={<CartPage />} />
        <Route path="/checkout"  element={<CheckoutPage />} />
        <Route path="/order-confirmation/:num" element={<OrderConfirmationPage />} />
        {/* Generic catch-all so any page created in the website editor is
            reachable at its clean slug (e.g. /dark-minimal-hero), not just
            /p/<slug>, without needing a hardcoded route per page. React
            Router ranks static routes above this dynamic one, so it never
            shadows /login, /dashboard, /blog, etc. — only truly unmatched
            single-segment paths fall through to here. */}
        <Route path="/:slug"      element={<WebsitePublicPage />} />
      </Route>

      {LEGACY_ADMIN_SEGMENTS.map((seg) => (
        <Route key={seg} path={`/${seg}/*`} element={<LegacyAdminRedirect />} />
      ))}

      <Route path="*" element={<NotFound />} />
    </Routes>
    </ErrorBoundary>
  );
}
