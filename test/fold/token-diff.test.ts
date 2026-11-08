// The token diff a transform's code is folded with: the tokens common to every
// target stay, and each stretch between them that differs is one value.
import { describe, expect, it } from "vitest";
import { stretches, tokens } from "../../src/fold/token-diff.js";

/** Each stretch as each target's text, the ones that differ marked. */
function texts(...versions: string[]) {
  const lists = versions.map(tokens);
  return stretches(lists).map((stretch) => {
    const each = lists.map((list, index) =>
      list.slice(stretch.starts[index], stretch.ends[index]).join(""),
    );
    return stretch.same ? each[0] : each;
  });
}

describe("the token diff", () => {
  it("gives each value that differs its own stretch, on separate lines", () => {
    expect(
      texts(
        "WHERE region = 'north-east'\n  AND total > 1",
        "WHERE region = 'north'\n  AND total > 2",
        "WHERE region = 'west'\n  AND total > 3",
      ),
    ).toEqual([
      "WHERE region = '",
      ["north-east", "north", "west"],
      "'\n  AND total > ",
      ["1", "2", "3"],
    ]);
  });

  it("takes a token next to a value that is empty in one target", () => {
    expect(texts("a b c", "a c")).toEqual(["a", [" b ", " "], "c"]);
    expect(texts("x y", "y")).toEqual([["x y", "y"]]);
  });

  it("keeps text that is the same in every target as one stretch", () => {
    expect(texts("SELECT 1", "SELECT 1")).toEqual(["SELECT 1"]);
  });
});
