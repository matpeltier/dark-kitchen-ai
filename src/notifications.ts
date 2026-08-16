import { runCommand } from "./command.js";
import { isMacOS } from "./utils.js";

export async function notify(title: string, message: string): Promise<void> {
  if (!isMacOS()) return;
  await runCommand("osascript", ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]);
}
