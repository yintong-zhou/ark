/// <reference types="vite/client" />
import type { ArkApi } from '@shared/types';

declare global {
  interface Window {
    ark: ArkApi;
  }
}
