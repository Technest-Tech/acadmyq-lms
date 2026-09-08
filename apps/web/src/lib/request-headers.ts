/**
 * Request headers this app sets on itself in middleware and reads back during render.
 *
 * Their names live here, rather than in `middleware.ts`, so a server component can read one without
 * importing the middleware module into the application runtime.
 */

/**
 * The path being rendered — the path AFTER any middleware rewrite, so it names the route that
 * actually runs rather than the address the visitor typed.
 *
 * A layout has no other way to know which route is rendering beneath it. The root layout uses it
 * for exactly one decision: whether this render is a marketing page (which reads one translation
 * namespace) or an application page (which reads all of them).
 */
export const PATHNAME_HEADER = "x-pathname";
