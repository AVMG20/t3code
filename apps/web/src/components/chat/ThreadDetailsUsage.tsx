import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  collectProviderUsageLimits,
  formatDuration,
  type LimitPace,
  limitsNotice,
  paceOf,
  sortProviderUsageWindows,
} from "@t3tools/shared/usageLimits";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import { ChevronsUpDownIcon, RefreshCwIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { barColor, shortWindowLabel } from "../usage/UsageLimits";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./compaction.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: "Ahead of pace",
  on: "On pace",
  under: "Under pace",
};

export interface ThreadDetailsUsageInput {
  readonly environmentId: EnvironmentId;
  /** Shows or hides the full usage panel above the composer. */
  readonly onToggleLimits?: (() => void) | undefined;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
}

type UsageTone = "error" | "warning" | null;

/** The selected provider's limit windows, in its profile colour. Each row reads as share used. */
export function ThreadDetailsUsage({
  environmentId,
  onToggleLimits,
  providerInstanceId,
  providers,
  sources,
}: Omit<ThreadDetailsUsageInput, "contextWindow">) {
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const report =
    providerInstanceId !== null
      ? collectProviderUsageLimits(providerInstanceId, providers, sources, now)
      : null;
  // Only this instance's data: the report keeps one instance per login, and any other entry may be
  // a different login or workspace, so fall back to the instance's own snapshot.
  const account = report?.accounts.find((entry) => entry.instanceId === providerInstanceId);
  const provider = providers.find((entry) => entry.instanceId === providerInstanceId);
  const limits = account?.limits ?? provider?.usageLimits;
  if (!limits || providerInstanceId === null) return null;
  const notice = limitsNotice(limits);
  const driver = provider?.driver ?? account?.driver;
  const color =
    normalizeProviderAccentColor(provider?.accentColor ?? account?.accentColor) ??
    (driver ? barColor(driver) : "var(--foreground)");
  const profile = provider?.displayName?.trim() || account?.label || String(providerInstanceId);
  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void Promise.resolve(
      refreshProviders({ environmentId, input: { instanceId: providerInstanceId, usage: true } }),
    ).finally(() => setRefreshing(false));
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title="Usage limits"
      showHeading={false}
    >
      <div className="mb-0.5 flex h-6 items-center gap-1 px-1 text-xs">
        <button
          type="button"
          onClick={onToggleLimits}
          disabled={!onToggleLimits}
          aria-label={`${profile}: toggle usage limits`}
          className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:hover:bg-transparent dark:hover:bg-white/[0.08]"
          style={{ color }}
        >
          <span className="truncate">{profile}</span>
          {onToggleLimits ? <ChevronsUpDownIcon className="size-3 shrink-0 opacity-70" /> : null}
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh usage limits"
          className="ms-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/70 outline-none hover:bg-black/[0.035] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:hover:bg-white/[0.08]"
        >
          <RefreshCwIcon className={cn("size-3", refreshing && "animate-spin")} />
        </button>
      </div>
      {/* Fixed label and value widths keep the bars the same length for every profile. */}
      <div className="grid grid-cols-[4.5rem_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        {notice ? (
          <UsageRow
            label="Limits"
            fill={null}
            tone={null}
            value="Unavailable"
            tooltip={<span className="text-foreground">{notice}</span>}
          />
        ) : (
          sortProviderUsageWindows(driver, limits.windows).map((window) => (
            <LimitRow key={window.id} window={window} now={now} color={color} />
          ))
        )}
      </div>
    </ThreadDetailsSection>
  );
}

/** The thread's context window. The bar fills as context is used; the tick marks auto-compaction. */
export function ThreadDetailsContext({ usage }: { readonly usage: ContextWindowSnapshot }) {
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const threshold = usage.autoCompactThreshold ?? null;
  const tick =
    maxTokens !== null && threshold !== null && threshold > 0 && threshold < maxTokens
      ? (threshold / maxTokens) * 100
      : null;
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title="Context window"
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        <UsageRow
          label="Context"
          fill={used}
          tone={used === null ? null : used >= 90 ? "error" : used >= 80 ? "warning" : null}
          tick={tick}
          muted
          value={
            maxTokens !== null
              ? `${usedTokens} / ${formatContextWindowTokens(maxTokens)}`
              : usedTokens
          }
          ariaValue={used !== null ? `${used}% used` : `${usedTokens} tokens used`}
          tooltip={
            <>
              <span className="text-foreground">
                {used !== null ? `Context: ${used}% used` : `Context: ${usedTokens} tokens used`}
              </span>
              {maxTokens !== null ? (
                <span className="text-muted-foreground">
                  {usage.usedTokens.toLocaleString("en-US")} of {maxTokens.toLocaleString("en-US")}{" "}
                  tokens
                </span>
              ) : null}
              {threshold !== null && threshold > 0 ? (
                <span className="text-muted-foreground">
                  {formatContextWindowCompactionMessage(threshold)}
                </span>
              ) : null}
            </>
          }
        />
      </div>
    </ThreadDetailsSection>
  );
}

/** Shortens compound provider labels (such as "Gemini · 5-hour") so they stay distinct in the compact rail. */
function compactWindowLabel(label: string): string {
  const shortened = shortWindowLabel(label);
  const separator = shortened.indexOf(" · ");
  if (separator === -1) return shortened;
  const rawFamily = shortened.slice(0, separator).trim();
  const rawCadence = shortened.slice(separator + 3).trim();
  const family = rawFamily.startsWith("Claude & GPT")
    ? "Other"
    : /^Gemini\s+\d+\s+/i.test(rawFamily)
      ? rawFamily.replace(/^Gemini\s+\d+\s+/i, "")
      : rawFamily;
  const cadence =
    rawCadence === "5-hour"
      ? "5h"
      : rawCadence === "Weekly"
        ? "7d"
        : rawCadence === "Reported quota"
          ? ""
          : rawCadence;
  return cadence ? `${family} ${cadence}` : family;
}

function LimitRow({
  window,
  now,
  color,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly color: string;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const used = Math.round(Math.max(0, Math.min(100, window.usedPercent)));
  const pace = paceOf(window, now);
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  const resetsIn = resetsAt > now ? formatDuration(resetsAt - now) : null;
  return (
    <UsageRow
      label={compactWindowLabel(window.label)}
      fill={used}
      tone={used >= 90 ? "error" : used >= 80 ? "warning" : null}
      color={color}
      value={`${used}%`}
      detail={resetsIn ?? ""}
      ariaValue={`${used}% used${resetsIn ? `, resets in ${resetsIn}` : ""}`}
      tooltip={
        <>
          <span className="text-foreground">
            {window.label}: {used}% used
          </span>
          {window.resetsAt && resetsAt > now ? (
            <span className="text-muted-foreground">
              Resets in {formatDuration(resetsAt - now)} ·{" "}
              {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)}
            </span>
          ) : null}
          {pace ? <span className="text-muted-foreground">{PACE_LABEL[pace]}</span> : null}
        </>
      }
    />
  );
}

/** One label, hairline, and value row; the whole row opens the details tooltip. */
function UsageRow({
  label,
  fill,
  tone,
  color,
  tick = null,
  value,
  detail = null,
  ariaValue = value,
  tooltip,
  muted = false,
}: {
  readonly label: string;
  /** Bar fill from 0 to 100. Null hides the bar. */
  readonly fill: number | null;
  readonly tone: UsageTone;
  /** Bar colour when no tone applies. */
  readonly color?: string;
  /** A marker on the bar, from 0 to 100. */
  readonly tick?: number | null;
  readonly value: string;
  /** Muted text after the value, such as the time to reset, in a fixed-width slot. */
  readonly detail?: string | null;
  readonly ariaValue?: string;
  readonly tooltip: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={`${label}: ${ariaValue}`}
            className="col-span-3 grid h-6 cursor-default grid-cols-subgrid items-center rounded-lg px-2.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]"
          />
        }
      >
        <span className="max-w-28 truncate text-muted-foreground">{label}</span>
        {fill !== null ? (
          <span className="relative h-[3px] rounded-full bg-muted-foreground/30 dark:bg-muted-foreground/20">
            {fill > 0 ? (
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  tone === "error"
                    ? "bg-error"
                    : tone === "warning"
                      ? "bg-warning"
                      : muted
                        ? "bg-muted-foreground"
                        : "bg-foreground/80",
                )}
                style={{
                  width: `max(${fill}%, 6px)`,
                  ...(tone === null && color ? { backgroundColor: color } : {}),
                }}
              />
            ) : null}
            {tick !== null ? (
              <span
                aria-hidden
                className="absolute -top-[3px] h-[9px] w-px -translate-x-1/2 bg-foreground/60"
                style={{ left: `${tick}%` }}
              />
            ) : null}
          </span>
        ) : null}
        <span
          className={cn(
            // Text-only rows span the bar column so they never widen the shared value column.
            "text-end font-medium tabular-nums",
            fill === null && "col-span-2",
            tone === "error"
              ? "text-error-foreground"
              : tone === "warning"
                ? "text-warning-foreground"
                : fill === null
                  ? "text-muted-foreground"
                  : "text-foreground/80",
          )}
        >
          {detail === null ? (
            value
          ) : (
            <span className="flex items-center justify-end">
              <span className="w-8 text-end">{value}</span>
              <span className="min-w-16 ps-1.5 text-start font-normal whitespace-nowrap text-muted-foreground">
                {detail ? `· ${detail}` : ""}
              </span>
            </span>
          )}
        </span>
      </TooltipTrigger>
      {/* Rows sit 8px inside the card; clear its edge instead of overlapping it. */}
      <TooltipPopup side="left" sideOffset={16}>
        <div className="flex flex-col gap-0.5">{tooltip}</div>
      </TooltipPopup>
    </Tooltip>
  );
}
