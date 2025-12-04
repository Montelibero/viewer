export function shorten(value) {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.length <= 12) return str;
  return str.slice(0, 4) + '…' + str.slice(-4);
}

export function isLocalLike() {
  return window.location.protocol === 'file:' || location.hostname === 'localhost';
}
