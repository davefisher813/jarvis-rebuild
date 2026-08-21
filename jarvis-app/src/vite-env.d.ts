/// <reference types="vite/client" />

// True only in a demo/preview build. Guards every import of seed data so the
// real bundle never contains it. See vite.config.ts.
declare const __DEMO_SEED__: boolean;
