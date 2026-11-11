// Игра как приложение: офлайн-кэш (service worker), установка на телефон, 2D для слабых телефонов.

type BIP = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIP | null = null;

export const PWA = {
  get standalone() {
    return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  },
  get ios() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
  get canPrompt() { return !!deferred; },
  /** true — показали системное окно установки */
  async install(): Promise<'ok' | 'dismissed' | 'manual'> {
    if (!deferred) return 'manual';
    const d = deferred;
    deferred = null;
    await d.prompt();
    const r = await d.userChoice.catch(() => ({ outcome: 'dismissed' }));
    return r.outcome === 'accepted' ? 'ok' : 'dismissed';
  },
  boot() {
    addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as BIP; });
    addEventListener('appinstalled', () => { deferred = null; });
    // кэш только для настоящего сайта: не в превью, не в мини-приложении внутри iframe-песочницы
    const real = location.protocol === 'https:' || location.hostname === 'localhost';
    if ('serviceWorker' in navigator && real && window.top === window && !new URLSearchParams(location.search).has('nosw')) {
      addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }
  },
};

/** Слабый телефон: мало памяти/ядер или старая видеокарта — при первом запуске предлагаем 2D. */
export function weakDevice(): boolean {
  const n = navigator as unknown as { deviceMemory?: number; hardwareConcurrency?: number };
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;
  if (!mobile) return false;
  const mem = n.deviceMemory ?? 4;
  const cores = n.hardwareConcurrency ?? 4;
  if (mem <= 3 || cores <= 4) return true;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (/Mali-(4|T[67])|Adreno \(TM\) [3-5]\d\d|PowerVR SGX|Mali-G(31|51|52)/i.test(gpu)) return true;
  } catch { return true; }
  return false;
}
