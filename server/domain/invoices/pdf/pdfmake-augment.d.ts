/**
 * Local augmentation for `@types/pdfmake`.
 *
 * Upstream types omit the server-only `setUrlAccessPolicy` callback
 * that pdfmake exposes at runtime (see `node_modules/pdfmake/js/base.js`).
 * We call it from `render.ts` to silence pdfmake's "No URL access policy
 * defined" warning while also hard-denying every external fetch —
 * invoices never reference remote images or fonts.
 *
 * The `import 'pdfmake'` side-effect import below is what turns this
 * file into a module-augmentation declaration rather than an ambient
 * redeclaration that would shadow the real types.
 */

import 'pdfmake';

declare module 'pdfmake' {
  export function setUrlAccessPolicy(
    callback: (url: string) => boolean,
  ): void;
}
