import DataversePowerToolsContext from "../context";
import { generateEarlyBoundV3 } from "../general/modelbuilder";

// Early-bound generation for an Azure Function component (#145 item 5) reuses the EXISTING
// plugin path verbatim: pac modelbuilder, authenticated through
// `ensurePacAuthForCurrentConnection` (which works for both service-principal and interactive
// connections). Settings live in the component's modelbuilder.json exactly as they do for a
// plugin component, so there is no separate modelbuilder implementation to keep in sync.
export async function generateAzureFunctionEarlyBound(context: DataversePowerToolsContext): Promise<void> {
  await generateEarlyBoundV3(context);
}
