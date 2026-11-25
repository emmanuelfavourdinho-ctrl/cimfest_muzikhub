# ADR 0002 — Linting with Oxlint; design-token guard

- **Status:** accepted (2026-11-24). This deviates from "ESLint". Veto if needed.
- **Context:** the owner asked for ESLint and Prettier. ESLint needs typescript-eslint to read TypeScript, which in turn needs the TypeScript compiler's JavaScript API (`createSourceFile` and friends). This project uses **TypeScript 7**, the native compiler, which **ships no JavaScript API**, so typescript-eslint can't run.

## Decision

- **Prettier 3** formats everything except Markdown and the frozen landing page. `npm run format` and `npm run format:check` are available. The one-time reformat is commit `a18e568`, listed in `.git-blame-ignore-revs`.
- **Oxlint** (Rust; parses TypeScript itself; uses ESLint rule names) is the linter.
  - Config: `.oxlintrc.json`. Plugins: typescript, react, jsx-a11y, import, unicorn, oxc.
  - Errors: correctness rules, `react/rules-of-hooks`, `react/exhaustive-deps`, `typescript/no-explicit-any`, `import/no-cycle`, `no-console` (except scripts, server entry and tests), `eqeqeq`.
- **Token guard** `scripts/check-tokens.mjs` fails `npm run lint` on raw hex/rgb/hsl/oklch colours or one-off pixel sizes in web components.
  - Exempt: `src/styles/`, `src/design/`, and the frozen `features/landing/` (audited: artwork stripe widths only).
  - Per-line exceptions need `tokens-allow: <reason>`.

## Rules turned off, and why

| Rule | Reason |
|---|---|
| `jsx-a11y/prefer-tag-over-role` | ARIA roles on generic elements (`role="status"`, `progressbar`, `img`, `group`, `region`) are valid; axe checks them |
| `react/purity`, `react/incompatible-library` | Rules for the React Compiler, which isn't used |
| `react/exhaustive-effect-dependencies` | Duplicates `react/exhaustive-deps` |
| `oxc/no-async-endpoint-handlers` | Express 5 forwards rejected promises to the error handler |
| `no-underscore-dangle` | Prisma's `_count` |
| `jsx-a11y/no-noninteractive-tabindex`: allows `role="region"` (and `tabpanel`) | Scrollable areas such as admin tables must be keyboard-focusable (axe `scrollable-region-focusable`, WCAG 2.1.1); a labelled region is the standard pattern |
| `jsx-a11y/interactive-supports-focus` (landing only) | The `tablist` container isn't meant to be focusable (WAI-ARIA tabs pattern); its tabs are |

**Per-line exceptions** (each has a comment):
- dialog backdrop click (Escape closes natively);
- `<audio>`/`<video>` without caption tracks (uploads carry none yet; tracked gap);
- `<details>` labelled by its `<summary>`;
- the development console mail transport.

## Consequences

Oxlint's rule set differs slightly from ESLint's. If TypeScript 7 gains a JavaScript API, ESLint can be revisited. Warnings are reported but don't fail CI; errors do.
