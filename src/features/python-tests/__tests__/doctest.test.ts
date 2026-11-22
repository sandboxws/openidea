import { describe, expect, it } from "vitest";
import { doctestOwners, examplePromptLine } from "../doctest";

const SOURCE = `"""Module.

>>> 1 + 1
2
"""
import math


def area(width,
         height):
    """Area.

    >>> area(2, 3)
    6
    """

    def local():
        """
        >>> local()
        """


class Shape:
    """No examples here."""

    def scaled(self, k):
        '''
        >>> Shape().scaled(2)
        ... # continued
        '''

    async def load(self):
        r"""
        >>> 1
        1
        """


def plain():
    return "not a docstring >>> here"
`;

describe("doctestOwners", () => {
  it("finds module, function and method docstrings with examples, not local functions", () => {
    expect(doctestOwners(SOURCE)).toEqual([
      { symbol: "", line: 0 },
      { symbol: "area", line: 8 },
      { symbol: "Shape.scaled", line: 25 },
      { symbol: "Shape.load", line: 31 },
    ]);
  });

  it("ignores files without examples", () => {
    expect(doctestOwners("def f():\n    '''Nothing.'''\n")).toEqual([]);
  });
});

describe("examplePromptLine", () => {
  it("finds the prompt of the example on a line", () => {
    const lines = SOURCE.split("\n");
    const prompt = lines.indexOf("        >>> Shape().scaled(2)");
    expect(examplePromptLine(SOURCE, prompt)).toBe(prompt + 1);
    // A continuation line belongs to the prompt above it.
    expect(examplePromptLine(SOURCE, prompt + 1)).toBe(prompt + 1);
    expect(examplePromptLine(SOURCE, prompt - 1)).toBeNull();
  });
});
