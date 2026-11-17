import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { makeUsageRefreshScheduler } from "./usageRefreshScheduler.ts";

const work = ProviderInstanceId.make("claudeAgent_work");
const personal = ProviderInstanceId.make("claudeAgent_personal");

const setup = Effect.gen(function* () {
  const refreshed: string[] = [];
  const scheduler = yield* makeUsageRefreshScheduler({
    refresh: (instanceId) => Effect.sync(() => void refreshed.push(instanceId)),
    listInstanceIds: Effect.succeed([work, personal]),
  });
  return { refreshed, scheduler };
});

describe("makeUsageRefreshScheduler", () => {
  it.effect("refreshes on start, every two minutes while running, and once on settle", () =>
    Effect.gen(function* () {
      const { refreshed, scheduler } = yield* setup;
      yield* scheduler.turnStarted(work, "turn-1");
      yield* scheduler.turnStarted(work, "turn-1");
      expect(refreshed).toEqual([work]);

      yield* TestClock.adjust("2 minutes");
      yield* TestClock.adjust("2 minutes");
      expect(refreshed).toEqual([work, work, work]);

      yield* scheduler.turnSettled(work, "turn-1");
      yield* scheduler.turnSettled(work, "turn-1");
      expect(refreshed).toEqual([work, work, work, work]);

      yield* TestClock.adjust("10 minutes");
      expect(refreshed).toEqual([work, work, work, work]);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps one loop while any of the instance's turns runs", () =>
    Effect.gen(function* () {
      const { refreshed, scheduler } = yield* setup;
      yield* scheduler.turnStarted(work, "turn-1");
      yield* scheduler.turnStarted(work, "turn-2");
      yield* scheduler.turnSettled(work, "turn-1");
      expect(refreshed).toEqual([work, work, work]);

      yield* TestClock.adjust("2 minutes");
      expect(refreshed).toEqual([work, work, work, work]);
    }).pipe(Effect.scoped),
  );

  it.effect("refreshes every instance hourly with no turn running", () =>
    Effect.gen(function* () {
      const { refreshed } = yield* setup;
      yield* TestClock.adjust("59 minutes");
      expect(refreshed).toEqual([]);
      yield* TestClock.adjust("1 minute");
      expect(refreshed).toEqual([work, personal]);
    }).pipe(Effect.scoped),
  );
});
