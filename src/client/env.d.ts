/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** адрес сервера клуба, если сайт и сервер на разных доменах (например, сайт на GitHub Pages) */
  readonly VITE_SERVER_URL?: string;
}
