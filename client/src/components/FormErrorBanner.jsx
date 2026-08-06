// Shared form-level error banner — matches the existing pattern in
// OrganizationsList.jsx's clientValidate()/formError so every form's error
// display looks the same instead of each page inventing its own markup.
export default function FormErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div className="alert alert-danger d-flex align-items-center gap-2 py-2 mb-3">
      <iconify-icon icon="solar:close-circle-line-duotone" class="fs-5"></iconify-icon>
      {error}
    </div>
  );
}
