# avmg fork notes

What the `avmg` branch changes on top of `pingdotgg/t3code` (`origin/main`), so the next upstream merge keeps it working.

Merge with `git merge origin/main` on a side branch, then fast-forward `avmg`. See everything we carry with `git diff origin/main avmg`.

## Custom features to keep

### Claude gateway usage (bitsec)

The Claude provider has a **Usage URL** setting (`usageUrl`). When Claude runs through a gateway (`ANTHROPIC_BASE_URL`), T3 calls that URL with `ANTHROPIC_AUTH_TOKEN` to read 5-hour and weekly usage. Ours points at `https://claude-admin.bitsec.dev/api/usage`. Top-level `seven_day_<model>` keys become per-model rows (for example "Fable").

- `packages/contracts/src/settings.ts` (`ClaudeSettings.usageUrl`)
- `apps/server/src/provider/claudeUsageLimits.ts` (`fetchClaudeGatewayUsage`, `withGatewayModelScoped`)
- `apps/server/src/provider/ClaudeProvider.ts`, `Drivers/ClaudeDriver.ts`, `Drivers/ClaudeSkills.ts`

### Usage card in thread details

The card shows the profile name in its accent colour (click to open or close the usage panel above the composer), a refresh button, and bars that fill as quota is **used** (upstream shows % left), with the reset time next to each value. Window labels are shortened (`Weekly · Fable` → `Fable`). Upstream's shared-pool rows (`PoolRow`) are kept as upstream wrote them.

- `apps/web/src/components/chat/ThreadDetailsUsage.tsx`: rebuilt on top of upstream's version in the Nov 2026 merge. Take upstream's file, then put back the header, `color`, `detail`, `compactWindowLabel` and the used-% `LimitRow`.
- `apps/web/src/components/usage/UsageLimits.tsx`: "% used" instead of "% left", `shortWindowLabel`
- `apps/web/src/components/chat/useUsageLimitsPanel.ts` (`toggle`), `ChatView.tsx` (passes `environmentId` and `onToggleLimits`)

### Usage refresh

- **Refresh button:** `refreshProviders` with `{ instanceId, usage: true }` refetches one instance's limits (`packages/contracts/src/rpc.ts`, `apps/server/src/ws.ts`, `snapshot.refreshUsage` in `ClaudeProvider.ts`).
- **Scheduler:** usage refreshes as turns start and settle (`apps/server/src/provider/usageRefreshScheduler.ts`, hooked in `orchestration-v2/ProviderEventIngestor.ts`).

### Remember last model per project

Sending a turn saves its model as the project's default for new threads. Setting `rememberLastModel`, on by default, can be turned off per project.

- `apps/web/src/lib/rememberProjectModel.ts`, `chat/useComposerSend.ts`, `settings/ProjectDefaultsSettings.tsx`, `packages/contracts/src/settings.ts`

### Global search finds threads only

`mod+shift+f` opens the command palette in a threads-only mode: threads, branches and messages, with no actions, settings or project contents.

- `apps/web/src/shortcuts/commandPaletteCommands.ts` (`ToggleThreadSearch`), `CommandPalette.tsx` (`threadsOnly`), `CommandPalette.logic.ts`

### Changes default to uncommitted work

The Changes row counts only uncommitted changes, labelled "Uncommitted". The diff panel opens on the unstaged scope, not the branch range.

- `apps/web/src/components/GitActionsControl.logic.ts` (`resolveUncommittedTotals`), `GitActionsControl.tsx`
- `apps/web/src/diffPanelStore.ts` (`DEFAULT_SELECTION`), `hooks/useProactivePanels.ts`, `chat/useRightPanelActions.ts`

### Telemetry is opt-in

Product analytics (PostHog via `ingest.t3.codes`) and relay connection tracing are off unless `T3CODE_TELEMETRY_ENABLED=true`. Upstream turns both on outside CI.

- `apps/server/src/telemetry/AnalyticsService.ts` (`enabledByDefault`, `enabledAtStartup`)
- `packages/shared/src/otelEnvironment.ts` (`isRelayTracingEnabled`), plus its tests and `apps/server/src/cloud/relayTracing.test.ts`

## Dropped in favour of upstream

Don't bring these back. Upstream now does them itself.

- **Antigravity native Auto mode.** Ours was `a62e16068b` and `1caa1f5824`; upstream has its own (#39378, #39822).
- **Antigravity usage limits from the CLI keyring / macOS keychain.** Ours was `698ddc0a36` and `d49c3b334e`. Upstream keeps Google sign-ins out of the keyring and reads `antigravity-oauth-token`.
- **Antigravity usage limits altogether.** Upstream stopped reading them from Google's internal APIs (#43026), so our Antigravity usage refresh and window sorting (`sortProviderUsageWindows`) went with it.
- **Antigravity background commands that rewake the thread.** Fixed upstream (#39989, #39806, #40858, #39767).

## Building the desktop app

```sh
node scripts/build-desktop-artifact.ts --platform mac --target dir --arch arm64 --output-dir <dir>
```

Then replace `/Applications/T3 Code (Beta).app` with `<dir>/mac-arm64/T3 Code (Beta).app` (`ditto`).
