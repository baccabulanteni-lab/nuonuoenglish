/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string
  readonly VITE_APP_MODE: 'full' | 'grammar' | 'reading'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
