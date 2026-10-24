import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Test-only full-screen child; a shared file releases all four pane producers.
const [home, label] = process.argv.slice(2) as [string, string];
let typed = "";
let tick = 0;

function title(): string {
  return `\x1b[Hpane-${label} pid=${process.pid} tick=${tick} typed=${typed}\x1b[K\x1b[?25h`;
}

process.stdin.setRawMode(true);
process.stdin.on("data", (bytes: Buffer) => {
  typed += bytes.toString();
  writeFileSync(join(home, `typed-${label}`), typed);
  process.stdout.write(title());
});
process.stdout.write("\x1b[?1049h\x1b[2J" + title());
writeFileSync(join(home, `ready-${label}`), String(process.pid));

while (!(await Bun.file(join(home, "burst-start")).exists())) {
  await Bun.sleep(10);
}

const row = "\x1b[2;1H" + ".".repeat(120);
const trace = process.env.WORK_CRAFT_BURST_TRACE;
const started = performance.now();
const startedAt = Date.now();
const timings: { tick: number; writeMs: number; sleepMs: number }[] = [];
for (tick = 0; tick < 64; tick++) {
  const end = title();
  const rows = row.repeat(Math.floor((16_384 - end.length) / row.length));
  const beforeWrite = performance.now();
  process.stdout.write(rows + " ".repeat(16_384 - end.length - rows.length) + end);
  const afterWrite = performance.now();
  await Bun.sleep(60);
  timings.push({
    tick,
    writeMs: afterWrite - beforeWrite,
    sleepMs: performance.now() - afterWrite,
  });
  if (trace && tick % 8 === 7) {
    writeFileSync(
      join(home, `progress-${label}`),
      JSON.stringify({
        pid: process.pid,
        startedAt,
        elapsedMs: performance.now() - started,
        timings,
      }),
    );
  }
}
process.stdout.write(title());
writeFileSync(join(home, `done-${label}`), String(process.pid));
