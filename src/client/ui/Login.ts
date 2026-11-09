// Экран входа: аккаунт Google (Google Identity Services) или Telegram (Login Widget). Гостевого входа нет.

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
  el.className = 'login';
  const both = opts.google && opts.telegram;
  el.innerHTML = `
    <div class="login-card">
      <div class="lobby-logo"><span>♠</span><h1>QWX POKER</h1><p>закрытый клуб</p></div>
      <p class="login-text">Вход в клуб — по аккаунту${both ? ' Telegram или Google' : opts.telegram ? ' Telegram' : ' Google'}.<br>Ваши фишки и покупки сохраняются за аккаунтом.</p>
      ${opts.telegram ? '<div class="login-btn tg"></div>' : ''}
      ${both ? '<div class="login-or">или</div>' : ''}
      ${opts.google ? '<div class="login-btn gg"></div>' : ''}
      <div class="login-err"></div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
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
      s.onerror = () => { err.textContent = 'Не удалось загрузить вход Telegram — проверьте интернет'; };
      (el.querySelector('.login-btn.tg') as HTMLElement).appendChild(s);
    }
    if (opts.google) {
      loadGis().then(() => {
        const g = window.google!.accounts.id;
        g.initialize({ client_id: opts.google!, itp_support: true, callback: ({ credential }) => { finish('google', { credential }); } });
        g.renderButton(el.querySelector('.login-btn.gg') as HTMLElement, {
          theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ru', width: 280,
        });
      }).catch(() => { err.textContent = 'Не удалось загрузить вход Google — проверьте интернет'; });
    }
  });
}
