import { describe, expect, it } from "vitest";
import { readCommand } from "@/lib/server/board";

const failing = [
  "sh",
  "-c",
  'case "$1" in slow) sleep 0.4 ;; esac; echo "gh: API rate limit already exceeded for user ID 12345678." >&2; exit 1',
  "sh",
  "{lane}",
];

const errorOf = (lanes: string[]) =>
  readCommand(failing, lanes).then(
    () => "no error",
    (e: Error) => e.message,
  );

describe("a tickets.command that fails the same way for every lane", () => {
  it("gives the same error on every read, named by the first lane in lane order", async () => {
    const lanes = ["slow", "fast"];
    const errors = await Promise.all([errorOf(lanes), errorOf(lanes), errorOf(lanes)]);
    expect(new Set(errors).size).toBe(1);
    expect(errors[0]).toMatch(/^slow: .*API rate limit/);
  }, 20_000);
});
