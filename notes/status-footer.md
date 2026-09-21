# Pi status/footer API research

## Source found

The installed Ollama plugin (`%TEMP%/jiti/pi-ollama-cloud-index.*.mjs`) does **not** draw a footer
itself. It uses Pi's native extension API:

```js
ctx.ui.setStatus(USAGE_STATUS_KEY, formatUsageStatusColored(ctx.ui.theme, data)); // show
ctx.ui.setStatus(USAGE_STATUS_KEY, undefined);                                    // clear
```

## Pi 0.86.1 API (from dist/core/extensions/types.d.ts)

```ts
interface ExtensionUIContext {
  setStatus(key: string, text: string | undefined): void;  // footer/status bar
  // also available: setWidget(key, content, { placement }), setFooter(factory), setHeader(factory)
}
interface ExtensionContext {
  ui: ExtensionUIContext;
  mode: "tui" | "rpc" | "json" | "print";   // status bar is TUI-only
  model: Model<any> | undefined;
  signal: AbortSignal | undefined;
  sessionManager: ReadonlySessionManager;
}
```

Lifecycle used by Ollama (adopted here):

| Event | Action |
|---|---|
| `model_select` | if `ctx.model?.provider === "polza"` and `ctx.mode === "tui"` → activate; else deactivate |
| `agent_end` | throttled refresh |
| `session_shutdown` | clear status |
| command toggle | on/off |

`ReadonlyFooterDataProvider` exposes `getExtensionStatuses()` — i.e. `setStatus` values are surfaced
by the built-in footer, so no custom footer component is needed.

## Decision for pi-polza

- Use `ctx.ui.setStatus("polza-accounting", text)`.
- Show only when the active provider is `polza` and mode is `tui`.
- Format: `Polza 43.54 ₽ | Session 0.61 ₽` (balance unavailable → `Polza ? ₽`).
- Session value is the sum of `usage.cost_rub` only.
- Update immediately from `onUsageRecord`; balance refreshed on TTL (see `status.ts`).
- No automatic polling interval: refresh on activation, on completed request when TTL expired, and
  manually via `/polza-balance`.
