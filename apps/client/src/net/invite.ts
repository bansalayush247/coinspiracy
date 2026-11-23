import { normalizeRoomCode } from '@byzantine-council/shared';

const KEY = 'join';

// The code rides in the fragment, which browsers never send to the web server.
export function inviteLink(pageUrl: string, code: string): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = `${KEY}=${code}`;
  return url.href;
}

export function codeFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return normalizeRoomCode(params.get(KEY));
}
