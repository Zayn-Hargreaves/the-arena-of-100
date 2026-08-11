import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";

describe("Result champion description", () => {
  const t = createTranslator({ locale: "en", messages, namespace: "Result" });

  it.each([
    [0, "Became the arena's sole champion without facing an opponent!"],
    [1, "Defeated 1 opponent to become the arena's sole champion!"],
    [3, "Defeated 3 opponents to become the arena's sole champion!"],
  ])("formats %i opponents", (opponents, expected) => {
    expect(t("championDescription", { opponents })).toBe(expected);
  });
});
