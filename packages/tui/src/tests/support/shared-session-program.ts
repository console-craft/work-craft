import { appendFileSync } from "node:fs";

// Test-only child: the normal shell launches exactly one instance inside its PTY.
const log = process.argv[2]!;
let row = 10;
let col = 10;
let typed = "";
let replies = 0;
let pending = "";
let size = { cols: 80, rows: 24 };

function paint(): void {
  const measured = Bun.spawnSync(["stty", "size"], { stdin: "inherit", stderr: "pipe" });
  if (measured.exitCode !== 0) {
    throw new Error("Cannot measure the child PTY");
  }
  const [rows, cols] = new TextDecoder().decode(measured.stdout).trim().split(/\s+/).map(Number);
  size = { cols: cols!, rows: rows! };
  appendFileSync(log, `${JSON.stringify({ pid: process.pid, row, col, typed, replies, size })}\n`);
  let frame = `\x1b[2J\x1b[Hshared pid=${process.pid} size=${cols}x${rows}\r\nshared cursor row=${row} col=${col} typed=${typed} replies=${replies}`;
  for (let line = 3; line <= rows!; line++) {
    frame += `\x1b[${line};1Hline ${String(line).padStart(3, "0")} ${".".repeat(Math.max(0, cols! - 10))}`;
  }
  frame += `\x1b[${Math.min(row, rows!)};${Math.min(col, cols!)}H@\x1b[${Math.min(row, rows!)};${Math.min(col, cols!)}H\x1b[?25h`;
  process.stdout.write(frame);
}

process.stdin.setRawMode(true);
process.stdout.write("\x1b[?1049h");
process.on("SIGWINCH", paint);
process.stdin.on("data", (data: Buffer) => {
  pending += data.toString();
  while (pending.length > 0) {
    if (pending.startsWith("\x1b")) {
      // oxlint-disable-next-line no-control-regex -- Parse the terminal's cursor-position reply.
      const reply = /^\x1b\[\d+;\d+R/.exec(pending);
      if (!reply) {
        return;
      }
      pending = pending.slice(reply[0].length);
      replies++;
    } else {
      const key = pending[0]!;
      pending = pending.slice(1);
      switch (key) {
        case "h":
          col = Math.max(1, col - 1);
          break;
        case "l":
          col++;
          break;
        case "j":
          row++;
          break;
        case "k":
          row = Math.max(1, row - 1);
          break;
        case "u":
          row = 25;
          col = 90;
          break;
        case "?":
          process.stdout.write("\x1b[6n");
          break;
        case "q":
          process.stdout.write("\x1b[?1049l");
          process.stdin.setRawMode(false);
          process.exit(0);
          break;
        default:
          typed += key;
      }
    }
    paint();
  }
});
paint();
