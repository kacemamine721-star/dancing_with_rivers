/// <reference types="vite/client" />
/// <reference types="vite-plugin-glsl/ext" />

interface ImportMetaEnv {
  /** Base URL of the versioned data bundle, e.g. /data/2026-11-15 or a CDN URL. */
  readonly VITE_DATA_BASE_URL?: string;
  /** Optional Sentry DSN (off by default). */
  readonly VITE_SENTRY_DSN?: string;
  /** Optional privacy-friendly analytics switch (off by default). */
  readonly VITE_ANALYTICS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
