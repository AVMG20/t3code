import type { ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

const RUNNING_INTERVAL = Duration.minutes(2);
const IDLE_INTERVAL = Duration.hours(1);
/** A turn whose settle event never arrived stops holding its instance's refresh loop. */
const MAX_TURN_MS = 6 * 60 * 60_000;

export interface UsageRefreshScheduler {
  /** Refreshes now and every two minutes while any of the instance's turns runs. */
  readonly turnStarted: (instanceId: ProviderInstanceId, turnId: string) => Effect.Effect<void>;
  /** Refreshes once more; the loop stops at its next tick when no turn is left running. */
  readonly turnSettled: (instanceId: ProviderInstanceId, turnId: string) => Effect.Effect<void>;
}

/**
 * Keeps usage limits current: on turn start and settle, every two minutes while a turn runs on an
 * instance, and hourly for every instance. `refresh` coalesces concurrent calls per instance.
 */
export const makeUsageRefreshScheduler = Effect.fn("makeUsageRefreshScheduler")(function* (input: {
  readonly refresh: (instanceId: ProviderInstanceId) => Effect.Effect<void>;
  readonly listInstanceIds: Effect.Effect<ReadonlyArray<ProviderInstanceId>>;
}): Effect.fn.Return<UsageRefreshScheduler, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  const runningTurns = new Map<ProviderInstanceId, Map<string, number>>();
  const loops = new Set<ProviderInstanceId>();
  const nowMillis = Effect.map(DateTime.now, DateTime.toEpochMillis);

  const fork = (effect: Effect.Effect<void>) =>
    effect.pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid);

  const hasRunningTurn = (instanceId: ProviderInstanceId, now: number) => {
    const turns = runningTurns.get(instanceId);
    if (!turns) return false;
    for (const [turnId, startedAt] of turns) {
      if (now - startedAt > MAX_TURN_MS) turns.delete(turnId);
    }
    if (turns.size === 0) runningTurns.delete(instanceId);
    return turns.size > 0;
  };

  const runningLoop = Effect.fn("UsageRefreshScheduler.runningLoop")(
    function* (instanceId: ProviderInstanceId) {
      while (true) {
        yield* Effect.sleep(RUNNING_INTERVAL);
        if (!hasRunningTurn(instanceId, yield* nowMillis)) return;
        yield* input.refresh(instanceId);
      }
    },
    (effect, instanceId) =>
      effect.pipe(Effect.ensuring(Effect.sync(() => loops.delete(instanceId)))),
  );

  yield* fork(
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(IDLE_INTERVAL);
        const instanceIds = yield* input.listInstanceIds;
        yield* Effect.forEach(instanceIds, input.refresh, { discard: true });
      }
    }),
  );

  const turnStarted = Effect.fn("UsageRefreshScheduler.turnStarted")(function* (
    instanceId: ProviderInstanceId,
    turnId: string,
  ) {
    const turns = runningTurns.get(instanceId) ?? new Map<string, number>();
    if (turns.has(turnId)) return;
    turns.set(turnId, yield* nowMillis);
    runningTurns.set(instanceId, turns);
    yield* fork(input.refresh(instanceId));
    if (loops.has(instanceId)) return;
    loops.add(instanceId);
    yield* fork(runningLoop(instanceId));
  });

  const turnSettled = Effect.fn("UsageRefreshScheduler.turnSettled")(function* (
    instanceId: ProviderInstanceId,
    turnId: string,
  ) {
    const turns = runningTurns.get(instanceId);
    if (!turns?.delete(turnId)) return;
    if (turns.size === 0) runningTurns.delete(instanceId);
    yield* fork(input.refresh(instanceId));
  });

  return { turnStarted, turnSettled };
});
