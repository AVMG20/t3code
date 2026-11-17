import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { rememberProjectModelPatch } from "./rememberProjectModel";

const project = ProjectId.make("proforto");
const work = { instanceId: ProviderInstanceId.make("claudeAgent_work"), model: "claude-opus-5-5" };
const personal = {
  instanceId: ProviderInstanceId.make("claudeAgent_personal"),
  model: "claude-opus-5-5",
};

const withOverrides = (overrides: ServerSettings["projectSettingsOverrides"]): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  projectSettingsOverrides: overrides,
});

describe("rememberProjectModelPatch", () => {
  it("saves a new model while keeping the project's other overrides", () => {
    const settings = withOverrides({
      [project]: { defaultModelSelection: personal, defaultAutoPull: true },
    });
    expect(rememberProjectModelPatch(settings, project, work)).toEqual({
      projectSettingsOverrides: {
        [project]: { defaultModelSelection: work, defaultAutoPull: true },
      },
    });
  });

  it("skips a model the project already defaults to", () => {
    const settings = withOverrides({ [project]: { defaultModelSelection: work } });
    expect(rememberProjectModelPatch(settings, project, work)).toBeNull();
  });

  it("skips projects that turned remembering off", () => {
    const settings = withOverrides({ [project]: { rememberLastModel: false } });
    expect(rememberProjectModelPatch(settings, project, work)).toBeNull();
  });
});
