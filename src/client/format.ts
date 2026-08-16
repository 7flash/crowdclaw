export function shortAddress(address: string): string {
  return address ? `${address.slice(0, 5)}…${address.slice(-5)}` : "—";
}

export function number(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

export function tokens(value: number): string {
  if (value >= 1_000_000) return `${number(value / 1_000_000, 2)}m`;
  if (value >= 1_000) return `${number(value / 1_000, 1)}k`;
  return String(Math.max(0, Math.round(value)));
}

export function ago(timestamp: number): string {
  if (!timestamp) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
