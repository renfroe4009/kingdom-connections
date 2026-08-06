// =============================================================================
// SIC code reference data — used by the Organization form's industry dropdown.
// -----------------------------------------------------------------------------
// We list the 2-digit "Major Group" codes as the spine, plus a curated set of
// 4-digit drilldowns that are common for B2B / MSP-oriented prospects (which
// is the usual book of business for Manage-integrated CRMs). Picking one of
// these in the UI populates BOTH the human-readable `industry` label and the
// numeric `sic_code` on the organization.
//
// To extend: add the 4-digit code under the matching division, keep the list
// alphabetical-ish within each division so the dropdown stays scannable.
// Source: U.S. Department of Labor SIC manual (osha.gov/data/sic-manual).
// =============================================================================

// Each entry: { code, label, division }
// Division is just used for the optgroup; the value sent to the server is `code`.
const SIC_CODES = [
  // --- A. Agriculture, Forestry, Fishing -----------------------------------
  { code: '01', label: '01 — Agricultural Production / Crops',          division: 'Agriculture, Forestry, Fishing' },
  { code: '02', label: '02 — Agricultural Production / Livestock',      division: 'Agriculture, Forestry, Fishing' },
  { code: '07', label: '07 — Agricultural Services',                    division: 'Agriculture, Forestry, Fishing' },
  { code: '08', label: '08 — Forestry',                                 division: 'Agriculture, Forestry, Fishing' },
  { code: '09', label: '09 — Fishing, Hunting & Trapping',              division: 'Agriculture, Forestry, Fishing' },

  // --- B. Mining ------------------------------------------------------------
  { code: '13', label: '13 — Oil & Gas Extraction',                     division: 'Mining' },
  { code: '14', label: '14 — Mining & Quarrying of Nonmetallic Minerals', division: 'Mining' },

  // --- C. Construction ------------------------------------------------------
  { code: '15', label: '15 — Building Construction (General)',          division: 'Construction' },
  { code: '16', label: '16 — Heavy Construction (Non-Building)',        division: 'Construction' },
  { code: '17', label: '17 — Construction — Special Trade',             division: 'Construction' },

  // --- D. Manufacturing -----------------------------------------------------
  { code: '20', label: '20 — Food & Kindred Products',                  division: 'Manufacturing' },
  { code: '22', label: '22 — Textile Mill Products',                    division: 'Manufacturing' },
  { code: '23', label: '23 — Apparel & Other Finished Products',        division: 'Manufacturing' },
  { code: '24', label: '24 — Lumber & Wood Products',                   division: 'Manufacturing' },
  { code: '25', label: '25 — Furniture & Fixtures',                     division: 'Manufacturing' },
  { code: '26', label: '26 — Paper & Allied Products',                  division: 'Manufacturing' },
  { code: '27', label: '27 — Printing, Publishing & Allied',            division: 'Manufacturing' },
  { code: '28', label: '28 — Chemicals & Allied Products',              division: 'Manufacturing' },
  { code: '29', label: '29 — Petroleum Refining',                       division: 'Manufacturing' },
  { code: '30', label: '30 — Rubber & Misc. Plastics Products',         division: 'Manufacturing' },
  { code: '32', label: '32 — Stone, Clay, Glass & Concrete',            division: 'Manufacturing' },
  { code: '33', label: '33 — Primary Metal Industries',                 division: 'Manufacturing' },
  { code: '34', label: '34 — Fabricated Metal Products',                division: 'Manufacturing' },
  { code: '35', label: '35 — Industrial / Commercial Machinery',        division: 'Manufacturing' },
  { code: '3571', label: '3571 — Electronic Computers',                 division: 'Manufacturing' },
  { code: '3674', label: '3674 — Semiconductors & Related Devices',     division: 'Manufacturing' },
  { code: '36', label: '36 — Electronic & Other Electric Equipment',    division: 'Manufacturing' },
  { code: '37', label: '37 — Transportation Equipment',                 division: 'Manufacturing' },
  { code: '38', label: '38 — Measuring/Photographic/Medical Instruments', division: 'Manufacturing' },
  { code: '39', label: '39 — Miscellaneous Manufacturing',              division: 'Manufacturing' },

  // --- E. Transportation, Communications, Utilities ------------------------
  { code: '41', label: '41 — Local & Suburban Transit',                 division: 'Transportation, Communications, Utilities' },
  { code: '42', label: '42 — Trucking & Warehousing',                   division: 'Transportation, Communications, Utilities' },
  { code: '44', label: '44 — Water Transportation',                     division: 'Transportation, Communications, Utilities' },
  { code: '45', label: '45 — Air Transportation',                       division: 'Transportation, Communications, Utilities' },
  { code: '47', label: '47 — Transportation Services',                  division: 'Transportation, Communications, Utilities' },
  { code: '48', label: '48 — Communications',                           division: 'Transportation, Communications, Utilities' },
  { code: '4813', label: '4813 — Telephone Communications',             division: 'Transportation, Communications, Utilities' },
  { code: '4899', label: '4899 — Communications Services NEC',          division: 'Transportation, Communications, Utilities' },
  { code: '49', label: '49 — Electric, Gas & Sanitary Services',        division: 'Transportation, Communications, Utilities' },

  // --- F. Wholesale Trade --------------------------------------------------
  { code: '50', label: '50 — Wholesale Trade — Durable Goods',          division: 'Wholesale Trade' },
  { code: '5045', label: '5045 — Computers & Peripherals (Wholesale)',  division: 'Wholesale Trade' },
  { code: '51', label: '51 — Wholesale Trade — Nondurable Goods',       division: 'Wholesale Trade' },

  // --- G. Retail Trade -----------------------------------------------------
  { code: '52', label: '52 — Building Materials & Hardware',            division: 'Retail Trade' },
  { code: '53', label: '53 — General Merchandise Stores',               division: 'Retail Trade' },
  { code: '54', label: '54 — Food Stores',                              division: 'Retail Trade' },
  { code: '55', label: '55 — Auto Dealers & Service Stations',          division: 'Retail Trade' },
  { code: '56', label: '56 — Apparel & Accessory Stores',               division: 'Retail Trade' },
  { code: '57', label: '57 — Furniture & Home Furnishings Stores',      division: 'Retail Trade' },
  { code: '58', label: '58 — Eating & Drinking Places',                 division: 'Retail Trade' },
  { code: '59', label: '59 — Miscellaneous Retail',                     division: 'Retail Trade' },

  // --- H. Finance, Insurance, Real Estate ----------------------------------
  { code: '60', label: '60 — Depository Institutions (Banks)',          division: 'Finance, Insurance, Real Estate' },
  { code: '61', label: '61 — Non-depository Credit Institutions',       division: 'Finance, Insurance, Real Estate' },
  { code: '62', label: '62 — Security & Commodity Brokers',             division: 'Finance, Insurance, Real Estate' },
  { code: '63', label: '63 — Insurance Carriers',                       division: 'Finance, Insurance, Real Estate' },
  { code: '64', label: '64 — Insurance Agents, Brokers & Service',      division: 'Finance, Insurance, Real Estate' },
  { code: '65', label: '65 — Real Estate',                              division: 'Finance, Insurance, Real Estate' },
  { code: '67', label: '67 — Holding & Other Investment Offices',       division: 'Finance, Insurance, Real Estate' },

  // --- I. Services ---------------------------------------------------------
  { code: '70', label: '70 — Hotels, Lodging Places',                   division: 'Services' },
  { code: '72', label: '72 — Personal Services',                        division: 'Services' },
  { code: '73', label: '73 — Business Services',                        division: 'Services' },
  { code: '7371', label: '7371 — Computer Services (Custom Programming)', division: 'Services' },
  { code: '7372', label: '7372 — Prepackaged Software (SaaS / Software)', division: 'Services' },
  { code: '7373', label: '7373 — Computer Integrated Systems Design',   division: 'Services' },
  { code: '7374', label: '7374 — Data Processing & Preparation',        division: 'Services' },
  { code: '7378', label: '7378 — Computer Maintenance & Repair',        division: 'Services' },
  { code: '7379', label: '7379 — Computer Services / MSP — NEC',        division: 'Services' },
  { code: '7389', label: '7389 — Business Services NEC',                division: 'Services' },
  { code: '75', label: '75 — Auto Repair, Services & Parking',          division: 'Services' },
  { code: '76', label: '76 — Miscellaneous Repair Services',            division: 'Services' },
  { code: '78', label: '78 — Motion Pictures',                          division: 'Services' },
  { code: '79', label: '79 — Amusement & Recreation Services',          division: 'Services' },
  { code: '80', label: '80 — Health Services',                          division: 'Services' },
  { code: '8011', label: '8011 — Offices of Doctors of Medicine',       division: 'Services' },
  { code: '8021', label: '8021 — Offices of Dentists',                  division: 'Services' },
  { code: '8062', label: '8062 — General Medical & Surgical Hospitals', division: 'Services' },
  { code: '81', label: '81 — Legal Services',                           division: 'Services' },
  { code: '82', label: '82 — Educational Services',                     division: 'Services' },
  { code: '83', label: '83 — Social Services',                          division: 'Services' },
  { code: '86', label: '86 — Membership Organizations',                 division: 'Services' },
  { code: '87', label: '87 — Engineering, Accounting, R&D, Mgmt.',      division: 'Services' },
  { code: '8721', label: '8721 — Accounting, Auditing & Bookkeeping',   division: 'Services' },
  { code: '8742', label: '8742 — Management Consulting Services',       division: 'Services' },
  { code: '88', label: '88 — Private Households',                       division: 'Services' },
  { code: '89', label: '89 — Services NEC',                             division: 'Services' },

  // --- J. Public Administration --------------------------------------------
  { code: '91', label: '91 — Executive, Legislative & General Government', division: 'Public Administration' },
  { code: '92', label: '92 — Justice, Public Order & Safety',           division: 'Public Administration' },
  { code: '93', label: '93 — Public Finance, Taxation & Monetary Policy', division: 'Public Administration' },
  { code: '94', label: '94 — Administration of Human Resource Programs', division: 'Public Administration' },
  { code: '95', label: '95 — Environmental Quality & Housing',          division: 'Public Administration' },
  { code: '96', label: '96 — Administration of Economic Programs',      division: 'Public Administration' },
  { code: '97', label: '97 — National Security & International Affairs', division: 'Public Administration' },
];

// Stable order for divisions in the optgroup output.
const DIVISION_ORDER = [
  'Agriculture, Forestry, Fishing',
  'Mining',
  'Construction',
  'Manufacturing',
  'Transportation, Communications, Utilities',
  'Wholesale Trade',
  'Retail Trade',
  'Finance, Insurance, Real Estate',
  'Services',
  'Public Administration',
];

/** Group entries by division for an optgroup-style <select>. */
export function sicCodesByDivision() {
  const map = new Map(DIVISION_ORDER.map((d) => [d, []]));
  for (const item of SIC_CODES) {
    if (!map.has(item.division)) map.set(item.division, []);
    map.get(item.division).push(item);
  }
  return DIVISION_ORDER.filter((d) => map.get(d).length > 0).map((d) => ({
    division: d,
    items: map.get(d),
  }));
}

/** Look up an entry by SIC code (exact match). */
export function findSicByCode(code) {
  if (!code) return null;
  return SIC_CODES.find((s) => s.code === String(code)) || null;
}

/** Strip the "NN — " prefix to get the human-readable industry label. */
export function industryLabelFromSic(code) {
  const entry = findSicByCode(code);
  if (!entry) return '';
  // "73 — Business Services" → "Business Services"
  return entry.label.replace(/^[0-9]{2,4}\s*—\s*/, '');
}

export default SIC_CODES;
