import { formatPhone } from '../utils/phone.js';

/**
 * Drop-in phone input that auto-formats to NNN-NNN-NNNN.
 *
 * Usage:
 *   <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
 *
 * `onChange` receives the formatted string, not the native event.
 * All other props (className, placeholder, etc.) are forwarded to <input>.
 */
export default function PhoneInput({ value, onChange, className = 'form-control', placeholder = '999-999-9999', ...rest }) {
  return (
    <input
      type="tel"
      className={className}
      placeholder={placeholder}
      value={value || ''}
      onChange={(e) => onChange(formatPhone(e.target.value))}
      {...rest}
    />
  );
}
