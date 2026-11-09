import { ATTACHMENT_LIMITS } from "@homestorm/shared";
import { describe, expect, it } from "vitest";
import { briefFilesProblem } from "./attachments";

const image = { kind: "image" as const, textChars: 0 };
const text = (textChars: number) => ({ kind: "text" as const, textChars });

describe("the brief's file limits", () => {
  it("takes a CSV and a chart", () => {
    expect(briefFilesProblem([text(389), image])).toBeNull();
    expect(briefFilesProblem([])).toBeNull();
  });

  it("names the limit that's broken", () => {
    expect(briefFilesProblem(Array(ATTACHMENT_LIMITS.perMessage + 1).fill(text(1)))).toContain(
      `At most ${ATTACHMENT_LIMITS.perMessage} files`,
    );
    expect(briefFilesProblem(Array(ATTACHMENT_LIMITS.briefImages + 1).fill(image))).toContain(
      `At most ${ATTACHMENT_LIMITS.briefImages} images`,
    );
    expect(briefFilesProblem([text(ATTACHMENT_LIMITS.briefTextFileChars), text(1)])).toContain(
      "every seat gets them on every turn",
    );
  });
});
