import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  type LimitPace,
  type LimitPoolWindow,
  paceOf,
  remainingPercent,
  sortProviderUsageWindows,
} from "@t3tools/shared/usageLimits";
import { formatDuration, limitsNotice } from "@t3tools/shared/usageLimitsCopy";
import { Link } from "@tanstack/react-router";
import { msg, useGT, useLocale, useMessages } from "gt-react";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import { ChevronsUpDownIcon, RefreshCwIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { barColor, shortWindowLabel } from "../usage/UsageLimits";
import { useNowMinute } from "../../hooks/useNowMinute";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./compaction.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  nextPoolReset,
  poolSources,
  resolveThreadDetailsLimits,
  resolveThreadHttpQuotas,
} from "./ThreadDetailsUsage.logic";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: msg("Ahead of pace"),
  on: msg("On pace"),
  under: msg("Under pace"),
};

export interface ThreadDetailsUsageInput {
  readonly environmentId: EnvironmentId;
  /** Shows or hides the full usage panel above the composer. */
  readonly onToggleLimits?: (() => void) | undefined;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
}

type UsageTone = "error" | "warning" | null;

function limitTone(left: number): UsageTone {
  if (left <= 10) return "error";
  if (left <= 20) return "warning";
  return null;
}

/** The selected provider's limit windows, in its profile colour. Each row reads as share used. */
export function ThreadDetailsUsage({
  environmentId,
  onToggleLimits,
  providerInstanceId,
  model,
  providers,
  sources,
}: Omit<ThreadDetailsUsageInput, "contextWindow">) {
  const gt = useGT();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const resolved = resolveThreadDetailsLimits(providerInstanceId, model, providers, sources, now);
  const quotas = resolveThreadHttpQuotas(providerInstanceId, sources);
  if ((!resolved && quotas.length === 0) || providerInstanceId === null) return null;
  const provider = providers.find((entry) => entry.instanceId === providerInstanceId);
  const driver = provider?.driver;
  const color =
    normalizeProviderAccentColor(provider?.accentColor) ??
    (driver ? barColor(driver) : "var(--foreground)");
  const profile = provider?.displayName?.trim() || String(providerInstanceId);
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
      title={gt("Usage limits")}
      showHeading={false}
    >
      <div className="mb-0.5 flex h-6 items-center gap-1 px-1 text-xs">
        <button
          type="button"
          onClick={onToggleLimits}
          disabled={!onToggleLimits}
          aria-label={gt("{profile}: toggle usage limits", { profile })}
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
          aria-label={gt("Refresh usage limits")}
          className="ms-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/70 outline-none hover:bg-black/[0.035] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:hover:bg-white/[0.08]"
        >
          <RefreshCwIcon className={cn("size-3", refreshing && "animate-spin")} />
        </button>
      </div>
      {/* Fixed label and value widths keep the bars the same length for every profile. */}
      <div className="grid grid-cols-[4.5rem_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        {resolved?.kind === "pool"
          ? resolved.windows.map((window) => <PoolRow key={window.id} window={window} now={now} />)
          : resolved &&
            (quotas.length === 0 || limitsNotice(resolved.limits) === null) && (
              <InstanceRows limits={resolved.limits} now={now} color={color} driver={driver} />
            )}
        {quotas.map(({ key, accountLabel, window }) => (
          <LimitRow key={key} window={window} now={now} color={color} accountLabel={accountLabel} />
        ))}
      </div>
    </ThreadDetailsSection>
  );
}

function InstanceRows({
  limits,
  now,
  color,
  driver,
}: {
  readonly limits: ServerProviderUsageLimits;
  readonly now: number;
  readonly color: string;
  readonly driver: ServerProvider["driver"] | undefined;
}) {
  const gt = useGT();
  const m = useMessages();
  const notice = limitsNotice(limits, m);
  if (notice) {
    return (
      <UsageRow
        label={gt("Limits", { $context: "usage limits row label" })}
        fill={null}
        tone={null}
        value={gt("Unavailable")}
        tooltip={<span className="text-foreground">{notice}</span>}
        opensUsage
      />
    );
  }
  return sortProviderUsageWindows(driver, limits.windows).map((window) => (
    <LimitRow key={window.id} window={window} now={now} color={color} />
  ));
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
  const gt = useGT();
  const m = useMessages();
  const locale = useLocale();
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title={gt("Context window")}
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        <UsageRow
          label={gt("Context", { $context: "context window row label" })}
          fill={used}
          tone={used === null ? null : used >= 90 ? "error" : used >= 80 ? "warning" : null}
          tick={tick}
          muted
          value={
            maxTokens !== null
              ? `${usedTokens} / ${formatContextWindowTokens(maxTokens)}`
              : usedTokens
          }
          ariaValue={
            used !== null
              ? gt("{used}% used", { used })
              : gt("{usedTokens} tokens used", { usedTokens })
          }
          tooltip={
            <>
              <span className="text-foreground">
                {used !== null
                  ? gt("Context: {used}% used", { used })
                  : gt("Context: {usedTokens} tokens used", { usedTokens })}
              </span>
              {maxTokens !== null ? (
                <span className="text-muted-foreground">
                  {gt("{used} of {max} tokens", {
                    used: usage.usedTokens.toLocaleString(locale),
                    max: maxTokens.toLocaleString(locale),
                  })}
                </span>
              ) : null}
              {threshold !== null && threshold > 0 ? (
                <span className="text-muted-foreground">
                  {formatContextWindowCompactionMessage(threshold, m)}
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
  accountLabel,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly color: string;
  readonly accountLabel?: string;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const used = 100 - remainingPercent(window);
  const pace = paceOf(window, now);
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  const resetsIn = resetsAt > now ? formatDuration(resetsAt - now, m) : null;
  return (
    <UsageRow
      label={compactWindowLabel(window.label)}
      fill={used}
      tone={used >= 90 ? "error" : used >= 80 ? "warning" : null}
      color={color}
      value={`${used}%`}
      detail={resetsIn ?? ""}
      ariaValue={
        resetsIn
          ? gt("{used}% used, resets in {resetsIn}", { used, resetsIn })
          : gt("{used}% used", { used })
      }
      opensUsage
      tooltip={
        <>
          <span className="text-foreground">
            {gt("{label}: {used}% used", { label: window.label, used })}
          </span>
          {accountLabel ? <span className="text-muted-foreground">{accountLabel}</span> : null}
          {window.resetsAt && resetsIn ? (
            <span className="text-muted-foreground">
              {gt("Resets in {duration} · {time}", {
                duration: resetsIn,
                time: formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m),
              })}
            </span>
          ) : null}
          {pace ? <span className="text-muted-foreground">{m(PACE_LABEL[pace])}</span> : null}
        </>
      }
    />
  );
}

function PoolRow({ window, now }: { readonly window: LimitPoolWindow; readonly now: number }) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = window.remainingPercent;
  const accounts = window.members.length;
  const from = poolSources(window);
  const sourceLabels = [...from.hubs, ...(from.signedIn ? [gt("Signed-in accounts")] : [])];
  const next = nextPoolReset(window, now);
  const resetsAt = next?.member.window.resetsAt;
  const reset =
    next && resetsAt
      ? {
          duration: formatDuration(next.at - now, m),
          time: formatUpcomingTimestamp(resetsAt, timestampFormat, now, undefined, m),
        }
      : null;
  return (
    <UsageRow
      label={window.label}
      fill={left}
      tone={limitTone(left)}
      value={`${left}%`}
      ariaValue={gt("{left}% left", { left })}
      opensUsage
      tooltip={
        <>
          <span className="text-foreground">
            {accounts > 1
              ? gt("{label}: {left}% left across {accounts} accounts", {
                  label: window.label,
                  left,
                  accounts,
                })
              : gt("{label}: {left}% left", { label: window.label, left })}
          </span>
          {window.pace ? (
            <span className="text-muted-foreground">{m(PACE_LABEL[window.pace])}</span>
          ) : null}
          {next && reset ? (
            <span className="text-muted-foreground">
              {accounts > 1
                ? gt("+{percent}% in {duration} · {time}", {
                    percent: next.restoresPercent,
                    ...reset,
                  })
                : gt("Resets in {duration} · {time}", reset)}
            </span>
          ) : null}
          {sourceLabels.length > 0 ? (
            <span className="text-muted-foreground">
              {gt("From {sources}", { sources: sourceLabels.join(", ") })}
            </span>
          ) : null}
        </>
      }
    />
  );
}

/** One label, hairline, and value row; the whole row opens the details tooltip. With `opensUsage` it links to the usage page. */
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
  opensUsage = false,
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
  readonly opensUsage?: boolean;
}) {
  const gt = useGT();
  const rowProps = {
    "aria-label": gt("{label}: {value}", { label, value: ariaValue }),
    className: cn(
      "col-span-3 grid h-6 grid-cols-subgrid items-center rounded-lg px-2.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]",
      opensUsage
        ? "group cursor-pointer active:bg-black/[0.06] dark:active:bg-white/[0.12]"
        : "cursor-default",
    ),
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          opensUsage ? <Link to="/usage" {...rowProps} /> : <div tabIndex={0} {...rowProps} />
        }
      >
        <span className="max-w-28 truncate text-muted-foreground group-hover:text-foreground">
          {label}
        </span>
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
                className="absolute -top-[3px] h-[9px] w-px -translate-x-1/2 bg-foreground/75"
                style={{ left: `clamp(0.5px, ${tick}%, calc(100% - 0.5px))` }}
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
        <div className="flex flex-col gap-0.5">
          {tooltip}
          {opensUsage ? <span className="text-muted-foreground">{gt("Open usage")}</span> : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
