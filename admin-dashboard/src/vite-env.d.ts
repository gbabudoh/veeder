/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** HTTPS base URL for the admin API. Required at runtime (Req 16.3). */
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
