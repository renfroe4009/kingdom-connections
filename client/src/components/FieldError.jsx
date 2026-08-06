// Per-field inline validation message — pairs with FormErrorBanner (which is
// for whole-form/server errors). Use under an individual input.
export default function FieldError({ children }) {
  if (!children) return null;
  return <div className="text-danger small mt-1">{children}</div>;
}
