import { useEffect, useState } from 'react';

/** Returns `value` only after it has stopped changing for `delay` ms (e.g. search boxes). */
export function useDebounce<T>(value: T, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
