import { sicCodesByDivision, findSicByCode, industryLabelFromSic } from '../../lib/sicCodes.js';

/**
 * Industry / SIC code dropdown for the Organization form.
 *
 * Props:
 *   industry  string — current industry label (legacy free-text)
 *   sicCode   string — current sic_code
 *   onChange  ({ industry, sic_code }) => void
 *
 * Behavior:
 *   - Picking an entry sets BOTH `industry` (the human-readable label) and
 *     `sic_code` (the numeric code) so the two fields stay in sync.
 *   - If the org has a legacy `industry` value that doesn't match any SIC
 *     entry, we keep it visible as a "(custom)" option at the top so the
 *     user doesn't lose it on save. They can either keep it or pick a
 *     standard one.
 */
export default function IndustrySicSelect({ industry, sicCode, onChange }) {
  const groups = sicCodesByDivision();
  const currentMatch = findSicByCode(sicCode);

  // If the saved industry doesn't correspond to a SIC entry, surface it as
  // a "custom" choice so we don't silently drop it.
  const hasLegacy = !currentMatch && industry && industry.trim() !== '';

  function handleChange(e) {
    const value = e.target.value;
    if (value === '') {
      onChange({ industry: '', sic_code: '' });
      return;
    }
    if (value === '__legacy__') {
      // Keep legacy industry, blank sic_code — user explicitly kept the old text.
      onChange({ industry, sic_code: '' });
      return;
    }
    const entry = findSicByCode(value);
    if (entry) {
      onChange({ industry: industryLabelFromSic(entry.code), sic_code: entry.code });
    }
  }

  // Selected value: prefer sic_code if it matches, else "__legacy__" if there's
  // a free-text industry, else empty.
  const selectValue = currentMatch ? currentMatch.code : (hasLegacy ? '__legacy__' : '');

  return (
    <div>
      <select className="form-select" value={selectValue} onChange={handleChange}>
        <option value="">— Select industry —</option>
        {hasLegacy && (
          <option value="__legacy__">{industry} (custom — no SIC code)</option>
        )}
        {groups.map((g) => (
          <optgroup key={g.division} label={g.division}>
            {g.items.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {currentMatch && (
        <small className="text-muted">SIC code: <code>{currentMatch.code}</code></small>
      )}
      {hasLegacy && selectValue === '__legacy__' && (
        <small className="text-muted">Free-text industry preserved from before this dropdown existed. Pick a standard option to set a SIC code.</small>
      )}
    </div>
  );
}
