import { app } from "electron";

/** Dev = running under `electron-vite dev` (not packaged); prod = a built installer. */
export const isDev = !app.isPackaged;

/**
 * The web call client this desktop app wraps. We never rebuild the UI — we load it by URL.
 * Defaults to PRODUCTION (`https://acadmyq.com` — the APEX domain). This MUST match the origin the
 * API allows for credentialed calls: api.acadmyq.com returns `Access-Control-Allow-Origin:
 * https://acadmyq.com` for every request, so loading from `app.`/`www.` fails CORS on the join call.
 * To develop against a local web/API stack, set `ACADEMIQ_WEB_URL=http://localhost:3000`.
 */
export const TARGET_URL = process.env.ACADEMIQ_WEB_URL ?? "https://acadmyq.com";

/** Origin of TARGET_URL — the single trusted origin we grant media permissions to. */
export const TRUSTED_ORIGIN = new URL(TARGET_URL).origin;
