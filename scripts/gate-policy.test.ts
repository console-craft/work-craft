import { expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const { scripts } = await Bun.file(join(root, "package.json")).json();
type Job = {
  "runs-on": string;
  "timeout-minutes"?: number;
  if?: string;
  strategy?: { matrix: { runner: string[] } };
  steps: { run?: string }[];
};
type Workflow = {
  on: Record<string, { paths?: string[] } | null>;
  jobs: Record<string, Job>;
};

async function yaml(path: string): Promise<Workflow> {
  return Bun.YAML.parse(await Bun.file(join(root, path)).text()) as Workflow;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Execute real shell composition, replacing only external tools with trace sinks. */
async function trace(commands: string[], failLint = false) {
  const cases = Object.entries(scripts as Record<string, string>)
    .map(([name, script]) => `${quote(name)}) eval ${quote(script)} ;;`)
    .join("\n");
  const child = Bun.spawn(
    [
      "sh",
      "-ec",
      `bun() {
        if [ "$1" != run ]; then printf 'bun %s\\n' "$*"; return; fi
        shift
        case "$1" in ${cases} *) return 2 ;; esac
      }
      bunx() { printf 'bunx %s\\n' "$*"; }
      oxlint() { printf 'lint\\n'; test "$FAIL_LINT" != 1; }
      oxfmt() { printf 'format\\n'; }
      tsc() { printf 'types\\n'; }
      mkdir() { :; }
      ${commands.join("\n")}`,
    ],
    {
      cwd: root,
      env: { ...process.env, FAIL_LINT: failLint ? "1" : "0" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(error).toBe("");
  return { code, calls: output.trim().split("\n") };
}

test("commits run only staged tools; pushing checks core and stops on static failure", async () => {
  const hooks = Bun.YAML.parse(await Bun.file(join(root, "lefthook.yml")).text()) as Record<
    string,
    { jobs: { run: string }[] }
  >;
  const commit = await trace(
    hooks["pre-commit"]!.jobs.map(({ run }) => run.replaceAll("{staged_files}", "example.ts")),
  );
  expect(commit.code).toBe(0);
  expect(commit.calls).toHaveLength(2);
  expect(commit.calls[0]).toStartWith("bunx oxfmt ");
  expect(commit.calls[1]).toStartWith("bunx oxlint ");
  const push = hooks["pre-push"]!.jobs.map(({ run }) => run);
  expect(await trace(push)).toEqual({
    code: 0,
    calls: ["lint", "format", "types", "bun scripts/test-gates.ts core"],
  });
  expect(await trace(push, true)).toEqual({ code: 1, calls: ["lint"] });
});

test("PR CI always dispatches product acceptance and compiled smoke on both supported hosts", async () => {
  const workflow = await yaml(".github/workflows/ci.yml");
  expect(workflow.on.pull_request?.paths).toBeUndefined();
  const platforms: string[] = [];
  let coreJobs = 0;
  for (const job of Object.values(workflow.jobs)) {
    expect(job["timeout-minutes"]).toBe(15);
    const { calls, code } = await trace(job.steps.flatMap(({ run }) => (run ? [run] : [])));
    expect(code).toBe(0);
    if (calls.includes("bun scripts/test-gates.ts core")) {
      coreJobs++;
    }
    if (calls.includes("bun scripts/test-gates.ts acceptance")) {
      expect(job.if).toBeUndefined();
      platforms.push(...(job.strategy?.matrix.runner ?? [job["runs-on"]]));
      expect(calls.some((call) => call.startsWith("bun build --compile "))).toBe(true);
      expect(calls).toContain("bun scripts/run-bounded.ts 120000 bun scripts/smoke-build.ts");
    }
  }
  expect(coreJobs).toBe(1);
  expect(platforms.toSorted()).toEqual(["macos-14", "ubuntu-latest"]);
});

test("release certification includes every product gate; tooling is separately triggered", async () => {
  const release = await yaml(".github/workflows/release.yml");
  const certification = await trace(["bun run check:all"]);
  expect(certification.code).toBe(0);
  expect(certification.calls).toContain("bun scripts/test-gates.ts all");
  expect(certification.calls).toContain(
    "bun scripts/run-bounded.ts 120000 bun scripts/smoke-build.ts",
  );
  expect(certification.calls).not.toContain("bun scripts/test-gates.ts tooling");
  for (const job of Object.values(release.jobs)) {
    expect(job["timeout-minutes"]).toBe(15);
    const verify = job.steps.filter(({ run }) => run === "bun run check:all");
    expect(verify).toHaveLength(1);
  }
  const tooling = await yaml(".github/workflows/test-tooling.yml");
  expect(Object.hasOwn(tooling.on, "workflow_dispatch")).toBe(true);
  for (const event of ["push", "pull_request"]) {
    const patterns = tooling.on[event]?.paths ?? [];
    for (const path of [
      "bun.lock",
      "scripts/run-bounded.ts",
      "src/preview.ts",
      "src/preview-environment.ts",
      "packages/tui/src/tests/support/output-capacity.ts",
      "packages/server/src/terminal/projection.ts",
      "packages/tui/src/workbench/terminal-material.ts",
    ]) {
      expect(
        patterns.some((pattern) => new Bun.Glob(pattern).match(path)),
        path,
      ).toBe(true);
    }
  }
  for (const job of Object.values(tooling.jobs)) {
    expect(job["timeout-minutes"]).toBe(15);
    const result = await trace(job.steps.flatMap(({ run }) => (run ? [run] : [])));
    expect(result.code).toBe(0);
    expect(result.calls).toContain("bun scripts/test-gates.ts tooling");
  }
});
