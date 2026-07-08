import { AutomationEvent } from "./rules";
import { runAutomation } from "./engine";

export async function emitAutomationEvent(event: AutomationEvent): Promise<void> {
  const inline =
    process.env.AUTOMATION_EVENT_MODE === "inline" ||
    (process.env.NODE_ENV === "test" && process.env.AUTOMATION_EVENT_MODE !== "tailer");
  if (!inline) return;

  try {
    await runAutomation(event);
  } catch (error) {
    console.warn("[automation] event failed (non-fatal):", error);
  }
}
