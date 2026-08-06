export default function PriceDisplay({ price, comparePrice, size = '1rem' }) {
  const hasSale = comparePrice && Number(comparePrice) > Number(price);
  return (
    <span style={{ fontSize: size }}>
      {hasSale && <span style={{ textDecoration: 'line-through', color: '#9ca3af', marginRight: 8, fontSize: '0.85em' }}>${Number(comparePrice).toFixed(2)}</span>}
      <span style={{ fontWeight: 700, color: hasSale ? '#dc2626' : 'inherit' }}>${Number(price).toFixed(2)}</span>
    </span>
  );
}
