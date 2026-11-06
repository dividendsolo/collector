import type { Reporter, TestModule, Vitest } from "vitest/node";

// A skipped test fails the run (dotfiles AGENTS.md "Never skip a test").
// it.skip, skipIf, todo and a skip inside a test all count. A run filtered
// with -t is left alone: the tests it filters out are not skips. To change
// this, talk to James first.
export default class NoSkipReporter implements Reporter {
  private filtered = false;

  onInit(vitest: Vitest) {
    this.filtered = Boolean(vitest.config.testNamePattern);
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
    if (this.filtered) return;
    const skipped: string[] = [];
    for (const mod of testModules) {
      for (const test of mod.children.allTests()) {
        if (test.result().state === "skipped") skipped.push(`${mod.moduleId}: ${test.fullName}`);
      }
    }
    if (skipped.length === 0) return;
    console.error(
      `\nFAIL: ${skipped.length} skipped test(s). A skip is a failure here; fix the cause, change the test, or delete it:`,
    );
    for (const s of skipped) console.error(`  - ${s}`);
    process.exitCode = 1;
  }
}
