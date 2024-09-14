import DataversePowerToolsContext from "../context";


export function getProjectName(context: DataversePowerToolsContext): string {
  if (!context.projectSettings.placeholders) {
    return "plugins_src";
  }
  for (let i = 0; i < context.projectSettings.placeholders.length; i++) {
    if (context.projectSettings.placeholders[i].placeholder === "PROJECTNAMESPACE") {
      return context.projectSettings.placeholders[i].value;
    }
  }
  return "plugins_src";
}
