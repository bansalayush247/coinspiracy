/// <reference types="astro/client" />

declare module 'virtual:site-config' {
  export const playUrl: string;
  export const analyticsSrc: string | null;
}
