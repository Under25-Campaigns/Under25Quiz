export function isLocalOnlyHost(hostname) {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '').replace(/^::ffff:/, '');
  return name === 'localhost' || name.endsWith('.localhost') || name === '::' || name === '::1' ||
    name === '0.0.0.0' || /^127\.\d+\.\d+\.\d+$/.test(name);
}

export function roomJoinUrl(origin, code) {
  const url = new URL('/', origin);
  url.searchParams.set('room', code);
  return url.href;
}
