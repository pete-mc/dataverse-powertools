import { describe, it, expect } from "vitest";
import { serviceLayerFiles, serviceFileContent, serviceTestContent, hookFileContent, containerComponentContent, indexExampleContent } from "./pcfServiceLayer";

describe("serviceLayerFiles", () => {
  it("emits service (+ its test), hook, list, container, and an index example (PascalCased entity)", () => {
    const paths = serviceLayerFiles("widget").map((f) => f.path);
    expect(paths).toEqual([
      "services/WidgetService.ts",
      "services/WidgetService.spec.ts",
      "hooks/useWidgets.ts",
      "components/WidgetList.tsx",
      "components/WidgetContainer.tsx",
      "index.ts.example",
    ]);
  });

  it("defaults the entity to Widget", () => {
    expect(serviceLayerFiles().map((f) => f.path)).toContain("services/WidgetService.ts");
  });
});

describe("service layer contents", () => {
  it("service is pure TS with an injected WebApi (no React)", () => {
    const s = serviceFileContent("Widget");
    expect(s).toContain("export class WidgetService");
    expect(s).toContain("constructor(private readonly webApi: ComponentFramework.WebApi)");
    expect(s).not.toContain('from "react"');
  });

  it("hook binds the service to React state", () => {
    const h = hookFileContent("Widget");
    expect(h).toContain("export function useWidgets(service: WidgetService)");
    expect(h).toContain('from "react"');
  });

  it("container wires hook + service into the presentational list", () => {
    const c = containerComponentContent("Widget");
    expect(c).toContain("export const WidgetContainer");
    expect(c).toContain("useWidgets(service)");
    expect(c).toContain("<WidgetList");
  });

  it("emits a Jest test for the service with a mocked WebApi", () => {
    const t = serviceTestContent("Widget");
    expect(t).toContain('import { WidgetService } from "./WidgetService"');
    expect(t).toContain('describe("WidgetService"');
    expect(t).toContain("jest.fn().mockResolvedValue");
    expect(t).toContain("new WidgetService(webApi).getAll()");
  });

  it("index example matches the documented ReactControl contract", () => {
    const idx = indexExampleContent("Widget");
    expect(idx).toContain("implements ComponentFramework.ReactControl<IInputs, IOutputs>");
    expect(idx).toContain("public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement");
    expect(idx).toContain("new WidgetService(context.webAPI)");
    expect(idx).toContain("React.createElement(WidgetContainer");
    expect(idx).toContain('from "./generated/ManifestTypes"');
  });
});
