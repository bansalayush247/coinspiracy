/// <reference types="vite/client" />

// Unknown import.meta.env keys become type errors instead of `any`.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  // Optional origin of the Codex site, for "learn more" links.
  readonly VITE_SITE_URL?: string;
  // Set only by the smoke test build; exposes read-only positions for assertions.
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
