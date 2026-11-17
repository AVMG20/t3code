import type {
  ModelSelection,
  ProjectId,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

/**
 * The patch that saves a sent model as the project's default for new threads, or null when the
 * project opted out or already defaults to it.
 */
export function rememberProjectModelPatch(
  settings: ServerSettings,
  projectId: ProjectId,
  selection: ModelSelection,
): ServerSettingsPatch | null {
  const effective = resolveProjectSettings(settings, projectId).settings;
  if (!effective.rememberLastModel) return null;
  const current = settings.projectSettingsOverrides[projectId]?.defaultModelSelection ?? null;
  if (
    current !== null &&
    current.instanceId === selection.instanceId &&
    current.model === selection.model &&
    JSON.stringify(current.options ?? null) === JSON.stringify(selection.options ?? null)
  ) {
    return null;
  }
  return {
    projectSettingsOverrides: {
      [projectId]: {
        ...settings.projectSettingsOverrides[projectId],
        defaultModelSelection: selection,
      },
    },
  };
}
