// Платформа: вибро-отклик, «поделиться», безопасные зоны. В обычном браузере работает сам; внутри Telegram — ещё и полный экран.

interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string }; start_param?: string };
  platform: string;
  version: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  enableVerticalSwipes?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  setBottomBarColor?: (c: string) => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  lockOrientation?: () => void;
  HapticFeedback?: {
    impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(s: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  onEvent?: (e: string, cb: () => void) => void;
  openTelegramLink?: (url: string) => void;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
}

const tg: TgWebApp | undefined = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
const inTelegram = !!tg && !!tg.initData;

export const Telegram = {
  inside: inTelegram,
  initData: tg?.initData || '',
  user: tg?.initDataUnsafe?.user,
  startParam: tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('room') || '',

  boot() {
    if (!tg) return;
    tg.ready();
    tg.expand();
    const at = (v: string) => tg.isVersionAtLeast?.(v);
    tg.setHeaderColor?.('#050203');
    tg.setBackgroundColor?.('#050203');
    if (at('7.10')) tg.setBottomBarColor?.('#050203');
    // свайп вниз не закроет игру, пока сквизишь карты или двигаешь слайдер
    if (at('7.7')) tg.disableVerticalSwipes?.();
    // погружение на телефонах
    const mobile = tg.platform === 'ios' || tg.platform === 'android';
    if (mobile && at('8.0')) {
      try { tg.requestFullscreen?.(); } catch { /* старый клиент */ }
      try { tg.lockOrientation?.(); } catch { /* */ }
    }
    const applyInsets = () => {
      const s = tg.safeAreaInset || { top: 0, bottom: 0, left: 0, right: 0 };
      const c = tg.contentSafeAreaInset || { top: 0, bottom: 0, left: 0, right: 0 };
      const r = document.documentElement.style;
      r.setProperty('--safe-top', `${s.top + c.top}px`);
      r.setProperty('--safe-bottom', `${s.bottom + c.bottom}px`);
    };
    applyInsets();
    tg.onEvent?.('safeAreaChanged', applyInsets);
    tg.onEvent?.('contentSafeAreaChanged', applyInsets);
    tg.onEvent?.('fullscreenChanged', applyInsets);
    tg.onEvent?.('viewportChanged', applyInsets);
  },

  haptic(kind: 'tap' | 'bet' | 'turn' | 'win' | 'error' | 'select') {
    const h = tg?.HapticFeedback;
    if (!h) {
      // обычный браузер на телефоне — короткая вибрация
      const ms = { tap: 6, bet: 12, turn: 18, win: [14, 40, 22], error: [30, 30, 30], select: 4 }[kind];
      try { navigator.vibrate?.(ms as number | number[]); } catch { /* */ }
      return;
    }
    switch (kind) {
      case 'tap': h.impactOccurred('light'); break;
      case 'bet': h.impactOccurred('medium'); break;
      case 'turn': h.impactOccurred('rigid'); break;
      case 'win': h.notificationOccurred('success'); break;
      case 'error': h.notificationOccurred('error'); break;
      case 'select': h.selectionChanged(); break;
    }
  },

  /** Поделиться ссылкой: в Telegram — окно выбора чата, в браузере — системное «Поделиться» или копирование. */
  share(url: string, text: string): 'shared' | 'copied' | 'telegram' {
    if (tg?.openTelegramLink && inTelegram) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
      return 'telegram';
    }
    const nav = navigator as Navigator & { share?: (d: { url: string; text: string }) => Promise<void> };
    const mobile = matchMedia('(pointer: coarse)').matches;
    if (nav.share && mobile) { nav.share({ url, text }).catch(() => {}); return 'shared'; }
    navigator.clipboard?.writeText(url).catch(() => {});
    return 'copied';
  },

  /** при активной раздаче — подтверждение закрытия */
  guardClose(on: boolean) {
    if (on) tg?.enableClosingConfirmation?.(); else tg?.disableClosingConfirmation?.();
  },
};
