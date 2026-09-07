import { useEffect, useState } from 'react';
import { useCart } from '../context/CartContext.jsx';

// Live MM:SS countdown for an event-ticket cart item's checkout hold. When it
// hits 0 we refresh the cart — the server has already dropped the expired
// hold (see cart.js purgeExpiredHolds), so this just picks up the new state.
export default function TicketHoldCountdown({ item }) {
  const { holdSecondsLeft, refresh } = useCart();
  const [secondsLeft, setSecondsLeft] = useState(() => holdSecondsLeft(item));

  useEffect(() => {
    setSecondsLeft(holdSecondsLeft(item));
    const timer = setInterval(() => {
      const next = holdSecondsLeft(item);
      setSecondsLeft(next);
      if (next === 0) refresh();
    }, 1000);
    return () => clearInterval(timer);
  }, [item.hold_expires_at, holdSecondsLeft, refresh]);

  if (secondsLeft == null) return null;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const low = secondsLeft <= 60;
  return (
    <span
      className={`hold-badge${low ? ' hold-badge--low' : ''}`}
      title="Your ticket is held until you complete checkout"
    >
      Held {minutes}:{String(seconds).padStart(2, '0')}
    </span>
  );
}
