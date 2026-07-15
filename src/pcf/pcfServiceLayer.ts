// Pure generators for the PCF service-layer template (#141, option 3 — the
// opinionated "batteries-included" structure). Emits the service / hook /
// presentational-component / container files (the same separation the 0.14.5
// snippets teach) plus a fully-wired `index.ts.example` that matches the
// documented ComponentFramework.ReactControl contract:
//   https://learn.microsoft.com/power-apps/developer/component-framework/react-controls-platform-libraries
// Written as `.example` so it never overwrites the pac-generated index.ts — the
// user copies the wiring in. No `vscode` import → unit-tested.

export interface ServiceLayerFile {
  /** Path relative to the control root, e.g. "services/WidgetService.ts". */
  path: string;
  content: string;
}

function pascal(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ""));
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function serviceFileContent(entity: string): string {
  const E = pascal(entity);
  return `export interface ${E} {
  id: string;
  name: string;
}

/**
 * Service / domain layer: pure TypeScript, no React and no PCF lifecycle types,
 * so it can be unit-tested in isolation. Injected with the control's WebApi.
 */
export class ${E}Service {
  constructor(private readonly webApi: ComponentFramework.WebApi) {}

  async getAll(): Promise<${E}[]> {
    const result = await this.webApi.retrieveMultipleRecords("account", "?$select=name");
    return result.entities.map((entity) => ({ id: entity.accountid, name: entity.name }));
  }
}
`;
}

export function hookFileContent(entity: string): string {
  const E = pascal(entity);
  return `import { useEffect, useState } from "react";
import { ${E}Service, ${E} } from "../services/${E}Service";

/** Binding layer: wires a service to React state. No domain logic, no markup. */
export function use${E}s(service: ${E}Service): { items: ${E}[]; loading: boolean; error?: string } {
  const [items, setItems] = useState<${E}[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    service
      .getAll()
      .then((result) => {
        if (active) {
          setItems(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err?.message ?? String(err));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [service]);

  return { items, loading, error };
}
`;
}

export function listComponentContent(entity: string): string {
  const E = pascal(entity);
  return `import * as React from "react";
import { ${E} } from "../services/${E}Service";

export interface ${E}ListProps {
  items: ${E}[];
  loading: boolean;
  error?: string;
}

/** Presentational component: markup only, driven entirely by props. */
export const ${E}List: React.FC<${E}ListProps> = ({ items, loading, error }) => {
  if (loading) {
    return <div>Loading…</div>;
  }
  if (error) {
    return <div role="alert">{error}</div>;
  }
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
};
`;
}

export function containerComponentContent(entity: string): string {
  const E = pascal(entity);
  return `import * as React from "react";
import { ${E}Service } from "../services/${E}Service";
import { use${E}s } from "../hooks/use${E}s";
import { ${E}List } from "./${E}List";

/** Container: the one place a hook meets a service, feeding the presentational list. */
export const ${E}Container: React.FC<{ service: ${E}Service }> = ({ service }) => {
  const { items, loading, error } = use${E}s(service);
  return <${E}List items={items} loading={loading} error={error} />;
};
`;
}

/** A Jest unit test for the service — proves the domain layer is testable in
 * isolation with a mocked WebApi (the point of the service/hook/component split). */
export function serviceTestContent(entity: string): string {
  const E = pascal(entity);
  return `import { ${E}Service } from "./${E}Service";

// The service is pure TS — unit-test it with a mocked ComponentFramework.WebApi,
// no PCF host and no live Dataverse needed. Runs under Jest (\`npx jest\`).
describe("${E}Service", () => {
  it("maps retrieved records to the domain type", async () => {
    const webApi = {
      retrieveMultipleRecords: jest.fn().mockResolvedValue({
        entities: [{ accountid: "1", name: "Contoso" }],
      }),
    } as unknown as ComponentFramework.WebApi;

    const result = await new ${E}Service(webApi).getAll();

    expect(webApi.retrieveMultipleRecords).toHaveBeenCalledWith("account", "?$select=name");
    expect(result).toEqual([{ id: "1", name: "Contoso" }]);
  });
});
`;
}

/** A wired index.ts matching the documented ReactControl contract. Written as
 * `.example` — copy the updateView/imports into your generated index.ts. */
export function indexExampleContent(entity: string): string {
  const E = pascal(entity);
  return `import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ${E}Service } from "./services/${E}Service";
import { ${E}Container } from "./components/${E}Container";

// Copy the imports above and the updateView body below into your generated
// index.ts (keep your control's class name — this shows a "ControlClass" placeholder).
export class ControlClass implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private notifyOutputChanged: () => void;

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void): void {
    this.notifyOutputChanged = notifyOutputChanged;
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    const service = new ${E}Service(context.webAPI);
    return React.createElement(${E}Container, { service });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
`;
}

/** All service-layer files to write for a control, keyed by the example entity. */
export function serviceLayerFiles(entity = "Widget"): ServiceLayerFile[] {
  const E = pascal(entity);
  return [
    { path: `services/${E}Service.ts`, content: serviceFileContent(entity) },
    { path: `services/${E}Service.spec.ts`, content: serviceTestContent(entity) },
    { path: `hooks/use${E}s.ts`, content: hookFileContent(entity) },
    { path: `components/${E}List.tsx`, content: listComponentContent(entity) },
    { path: `components/${E}Container.tsx`, content: containerComponentContent(entity) },
    { path: `index.ts.example`, content: indexExampleContent(entity) },
  ];
}
