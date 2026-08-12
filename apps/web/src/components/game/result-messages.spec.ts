import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import messagesEn from "../../../messages/en.json";
import messagesVi from "../../../messages/vi.json";

describe("Result champion description", () => {
  const tEn = createTranslator({
    locale: "en",
    messages: messagesEn,
    namespace: "Result",
  });
  const tVi = createTranslator({
    locale: "vi",
    messages: messagesVi,
    namespace: "Result",
  });

  it.each([
    [0, "Became the arena's sole champion without facing an opponent!"],
    [1, "Defeated 1 opponent to become the arena's sole champion!"],
    [3, "Defeated 3 opponents to become the arena's sole champion!"],
  ])("formats %i opponents (en)", (opponents, expected) => {
    expect(tEn("championDescription", { opponents })).toBe(expected);
  });

  it.each([
    [
      0,
      "Đã trở thành quán quân duy nhất của đấu trường mà không phải đối đầu đối thủ nào!",
    ],
    [1, "Đã đánh bại 1 đối thủ khác để giành ngôi vị quán quân duy nhất!"],
    [3, "Đã đánh bại 3 đối thủ khác để giành ngôi vị quán quân duy nhất!"],
  ])("formats %i opponents (vi)", (opponents, expected) => {
    expect(tVi("championDescription", { opponents })).toBe(expected);
  });
});
