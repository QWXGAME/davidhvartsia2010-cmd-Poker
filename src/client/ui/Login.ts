// Экран входа: только аккаунт Telegram (официальный Login Widget). Гостевого входа нет.

import { Smoke } from './smoke';

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; auto_select?: boolean; itp_support?: boolean }): void;
      renderButton(el: HTMLElement, o: Record<string, unknown>): void;
      prompt(): void;
    } } };
    onTelegramAuth?: (u: Record<string, unknown>) => void;
  }
}

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error('gsi'));
    document.head.appendChild(s);
  });
}

export interface LoginOptions { google?: string; telegram?: string }

/** Показывает экран входа и ждёт, пока сервер подтвердит аккаунт. Возвращает сессию. */
export function login(opts: LoginOptions, httpBase: string): Promise<{ session: string; name: string }> {
  const el = document.createElement('div');
  el.className = 'login welcome';
  el.innerHTML = `
    <canvas class="welcome-smoke" aria-hidden="true"></canvas>
    <div class="welcome-card">
      <div class="w-suits"><i>♠</i><i class="r">♥</i><i>♣</i><i class="r">♦</i></div>
      <div class="w-seal">Q</div>
      <div class="w-kicker">Добро пожаловать в</div>
      <h1 class="w-title">QWX <em>POKER</em></h1>
      <div class="w-sub">закрытый покерный клуб</div>
      <div class="w-line"></div>
      <p class="w-text">Бархатное сукно, лакированный борт и друзья за одним столом.<br>Войдите через Telegram — получите стартовые фишки, а друзья смогут переводить вам фишки по @username.</p>
      <ul class="w-perks">
        <li><b>15 000</b><span>фишек на старт</span></li>
        <li><b>24/7</b><span>столы с друзьями</span></li>
        <li><b>0 ₽</b><span>игра бесплатна</span></li>
      </ul>
      <div class="login-btn tg"><div class="gg-fallback">Загружаем вход Telegram…</div></div>
      <div class="login-err"></div>
      <p class="w-legal">Вход только через аккаунт Telegram — так ваши фишки надёжно сохраняются за вами. Игра на виртуальные фишки, без денежных ставок.</p>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  // живой дым за приветствием
  new Smoke(el.querySelector('.welcome-smoke') as HTMLCanvasElement, 0.9).start();
  const err = el.querySelector('.login-err') as HTMLElement;
  return new Promise(resolve => {
    const finish = async (path: string, body: unknown) => {
      err.textContent = 'Проверяем вход…';
      try {
        const r = await fetch(`${httpBase}/auth/${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok || !j.session) throw new Error(j.error || 'Не удалось войти');
        el.classList.remove('open');
        setTimeout(() => el.remove(), 500);
        resolve({ session: j.session, name: j.name });
      } catch (e) {
        err.textContent = (e as Error).message || 'Не удалось войти';
      }
    };
    // Telegram: официальный виджет — открывает подтверждение в Telegram и возвращает подписанные данные
    if (opts.telegram) {
      window.onTelegramAuth = u => { finish('telegram', u); };
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://telegram.org/js/telegram-widget.js?22';
      s.setAttribute('data-telegram-login', opts.telegram);
      s.setAttribute('data-size', 'large');
      s.setAttribute('data-radius', '22');
      s.setAttribute('data-request-access', 'write');
      s.setAttribute('data-onauth', 'onTelegramAuth(user)');
      s.onload = () => (el.querySelector('.login-btn.tg .gg-fallback') as HTMLElement | null)?.remove();
      s.onerror = () => { err.textContent = 'Не удалось загрузить вход Telegram — проверьте интернет'; };
      (el.querySelector('.login-btn.tg') as HTMLElement).appendChild(s);
    }
    if (opts.google) {
      loadGis().then(() => {
        const g = window.google!.accounts.id;
        g.initialize({ client_id: opts.google!, itp_support: true, callback: ({ credential }) => { finish('google', { credential }); } });
        const box = el.querySelector('.login-btn.gg') as HTMLElement;
        box.innerHTML = '';
        g.renderButton(box, {
          theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', locale: 'ru', width: Math.min(320, innerWidth - 80), logo_alignment: 'left',
        });
      }).catch(() => { err.textContent = 'Не удалось загрузить вход Google — проверьте интернет'; });
    }
  });
}
