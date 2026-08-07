/// <reference types="vite/client" />

declare module "*.css";

interface ImportMetaEnv {
  readonly CESIUM_ION_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
