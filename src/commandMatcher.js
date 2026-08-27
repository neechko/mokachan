import { COMMAND_CASE_INSENSITIVE } from "./config.js";

// Dipakai oleh SEMUA command (termasuk lyrics) supaya prefix
// "m" / "M" konsisten case-insensitive di seluruh bot.
export function commandMatches(content, command) {
  if (COMMAND_CASE_INSENSITIVE) {
    const normalizedContent = content.toLowerCase();
    const normalizedCommand = command.toLowerCase();

    return (
      normalizedContent === normalizedCommand ||
      normalizedContent.startsWith(`${normalizedCommand} `)
    );
  }

  return (
    content === command ||
    content.startsWith(`${command} `)
  );
}
