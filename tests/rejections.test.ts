import { describe, expect, it } from "vitest";
import { explain } from "../src/ui/rejections.js";

/**
 * The engine names its refusals after the rule they enforce, which is right
 * for the engine and useless at the table. This is the only place that gets
 * translated, so it is the only place worth testing.
 */
describe("refusals in words", () => {
  it("says nothing at all for no refusal", () => {
    expect(explain(null)).toBeNull();
  });

  it("turns a rule name into an instruction", () => {
    expect(explain("cannotAffordCost")?.text).toBe(
      "Not enough energy or power.",
    );
    expect(explain("invalidDestination")?.text).toBe("It cannot go there.");
  });

  /**
   * The three a shared board produces on its own: the server is
   * authoritative, so two players clicking at once means the second one's
   * move lands against a board that has moved on. Nobody did anything wrong,
   * and it should not read as though they had.
   */
  it("marks a timing race as nobody's mistake", () => {
    for (const reason of ["decisionPending", "notYourPriority", "notYourFocus"]) {
      expect(explain(reason)?.race).toBe(true);
    }
    expect(explain("cannotAffordCost")?.race).toBe(false);
  });

  /** A silent refusal is worse than an ugly one. */
  it("still shows a reason it has no words for", () => {
    expect(explain("somethingNewAndUntranslated")?.text).toBe(
      "somethingNewAndUntranslated",
    );
  });
});
