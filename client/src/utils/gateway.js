// Payment gateway values are stored raw ('valor', 'authnet', 'manual') —
// 'manual' means a staff-recorded gift (check/cash/wire/other) that never
// touched a real payment processor, so it shouldn't be displayed as if it
// were one. Everywhere a payment's gateway is shown in a table/detail view,
// route it through this so "manual" reads as "N/A" instead of a fake gateway name.
export function formatGateway(gateway) {
  if (!gateway || gateway === 'manual') return 'N/A';
  if (gateway === 'authnet') return 'Authorize.Net';
  if (gateway === 'valor') return 'Valor';
  return gateway;
}
