import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../plugins/projectPaths", () => ({ findPrimaryPluginCsproj: vi.fn() }));
import { findPrimaryPluginCsproj } from "../plugins/projectPaths";
import { customApiHandlerDirectory } from "./customApiCommands";

// The generated C# handler declares the plug-in type the Custom API points at, so it has to live inside
// the folder the .csproj compiles. It was written to the COMPONENT ROOT instead — one level above the
// project — where an SDK-style project's `**/*.cs` glob never sees it. The consequences were invisible
// until a live run: the type never reached the assembly, so every Deploy Custom APIs ended in
// "plugin type '…' not found in the environment". These tests pin the location.

const csprojMock = findPrimaryPluginCsproj as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => csprojMock.mockReset());

describe("customApiHandlerDirectory", () => {
  it("puts the handler in the plug-in project's directory, not the component root", async () => {
    csprojMock.mockResolvedValue("C:/ws/MyPlugins/MyPlugins.csproj");
    expect(await customApiHandlerDirectory("C:/ws")).toBe("C:/ws/MyPlugins");
  });

  it("prefers the configured plug-in project when several exist", async () => {
    csprojMock.mockResolvedValue("C:/ws/Chosen/Chosen.csproj");
    expect(await customApiHandlerDirectory("C:/ws", "Chosen")).toBe("C:/ws/Chosen");
    expect(csprojMock).toHaveBeenCalledWith("C:/ws", "Chosen");
  });

  it("handles a project that IS the component root", async () => {
    csprojMock.mockResolvedValue("C:/ws/MyPlugins.csproj");
    expect(await customApiHandlerDirectory("C:/ws")).toBe("C:/ws");
  });

  it("falls back to the component root when there is no plug-in project", async () => {
    csprojMock.mockResolvedValue(undefined);
    expect(await customApiHandlerDirectory("C:/ws")).toBe("C:/ws");
  });
});
