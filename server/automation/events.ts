import { AutomationEvent } from "./rules";
import { runAutomation } from "./engine";

export async function emitAutomationEvent(event: AutomationEvent): Promise<void> {
  try {
    await runAutomation(event);
  } catch (error) {
    console.warn("[automation] event failed (non-fatal):", error);
  }
}
