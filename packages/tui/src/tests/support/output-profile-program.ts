import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Frozen local workload: sequence tokens, fixed-size redraws, no network/provider.
const [directory, label = "0", amount = "4096"] = process.argv.slice(2);
if (!directory) {
  throw new Error("Profile program requires an owned directory");
}
const bytesPerTick = Number(amount);
let sequence = 0;
let pending = "";
let tick = 0;
let active = true;
function title(): string {
  return `\x1b[Hprofile-${label} pid=${process.pid} probe=${sequence}; tick=${tick}\x1b[K\x1b[?25h`;
}
process.stdin.setRawMode(true);
process.stdin.on("data", (bytes: Buffer) => {
  pending += bytes.toString();
  let end: number;
  while ((end = pending.indexOf(";")) >= 0) {
    const command = pending.slice(0, end);
    pending = pending.slice(end + 1);
    if (command === "stop") {
      active = false;
      continue;
    }
    if (!/^p\d+$/.test(command)) {
      continue;
    }
    sequence = Number(command.slice(1));
    appendFileSync(
      join(directory, `inputs-${label}.jsonl`),
      JSON.stringify({ sequence, wallMs: performance.timeOrigin + performance.now() }) + "\n",
    );
    process.stdout.write(title());
  }
});
process.stdout.write("\x1b[?1049h\x1b[?2004h\x1b[2J" + title());
writeFileSync(
  join(directory, `ready-profile-${label}.json`),
  JSON.stringify({ pid: process.pid, cols: process.stdout.columns, rows: process.stdout.rows }),
);
setInterval(() => {
  if (!active) {
    return;
  }
  tick++;
  const popup = tick % 2 ? "\x1b[6;8H\x1b[44m popup \x1b[0m" : "\x1b[6;8H       ";
  const end = title();
  const row = "\x1b[2;1H" + ".".repeat(60);
  const repeats = Math.max(0, Math.floor((bytesPerTick - popup.length - end.length) / row.length));
  const body = row.repeat(repeats) + popup;
  process.stdout.write(
    body + " ".repeat(Math.max(0, bytesPerTick - body.length - end.length)) + end,
  );
}, 100);
