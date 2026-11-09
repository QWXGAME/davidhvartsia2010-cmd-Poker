// Игрок в браузере: секретный токен (узнаёт сервер) и имя за столом. Хранятся локально.

const rand = () => {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
};

function get(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } }

// код приглашения читаем один раз и сразу убираем из адреса — обновление страницы не сажает за стол снова
const roomFromUrl = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
// реферальный код друга (?ref=ABC123) — запоминаем до первого входа, сервер начислит бонус обоим
const refFromUrl = (new URLSearchParams(location.search).get('ref') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
if (refFromUrl) set('pn.ref', refFromUrl);
if (roomFromUrl || refFromUrl) {
  const u = new URL(location.href);
  u.searchParams.delete('room');
  u.searchParams.delete('ref');
  try { history.replaceState(null, '', u.toString()); } catch { /* */ }
}

export const Identity = {
  get token(): string {
    let t = get('pn.token');
    if (!t) { t = rand(); set('pn.token', t); }
    return t;
  },
  /** сессия после входа через Google (подписана сервером) */
  get session(): string { return get('pn.session') || ''; },
  set session(v: string) { if (v) set('pn.session', v); else { try { localStorage.removeItem('pn.session'); } catch { /* */ } } },
  get name(): string { return get('pn.name') || ''; },
  set name(v: string) { set('pn.name', v.trim().slice(0, 20)); },
  /** код стола из ссылки-приглашения: ?room=ABC123 */
  get room(): string { return roomFromUrl; },
  /** код пригласившего друга, если игрок пришёл по реферальной ссылке */
  get ref(): string { return get('pn.ref') || ''; },
  clearRef() { try { localStorage.removeItem('pn.ref'); } catch { /* */ } },
  refLink(code: string) { return `${location.origin}${location.pathname}?ref=${code}`; },
  inviteLink(room: string) { return `${location.origin}${location.pathname}?room=${room}`; },
};
