import { BadRequestException, ArgumentMetadata } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe";
import { describe, it, expect } from "vitest";

describe("ZodValidationPipe", () => {
  const schema = z.object({
    name: z.string().min(3),
    age: z.number().int().min(18),
  });

  const pipe = new ZodValidationPipe(schema);
  const mockMetadata: ArgumentMetadata = { type: "body" };

  it("should return validated data when input is valid", () => {
    const input = { name: "John Doe", age: 25 };
    const result = pipe.transform(input, mockMetadata);
    expect(result).toEqual(input);
  });

  it("should throw BadRequestException with formatted errors when validation fails", () => {
    const input = { name: "Jo", age: 16 };
    expect(() => pipe.transform(input, mockMetadata)).toThrow(
      BadRequestException,
    );

    try {
      pipe.transform(input, mockMetadata);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadRequestException);
      if (error instanceof BadRequestException) {
        const response = error.getResponse() as { message: string[] };
        expect(response.message).toBeDefined();
        expect(response.message).toContain(
          "name: String must contain at least 3 character(s)",
        );
        expect(response.message).toContain(
          "age: Number must be greater than or equal to 18",
        );
      }
    }
  });

  it("should handle nested paths correctly in error formatting", () => {
    const nestedSchema = z.object({
      user: z.object({
        profile: z.object({
          email: z.string().email(),
        }),
      }),
    });
    const nestedPipe = new ZodValidationPipe(nestedSchema);
    const input = { user: { profile: { email: "invalid-email" } } };

    expect(() => nestedPipe.transform(input, mockMetadata)).toThrow(
      BadRequestException,
    );

    try {
      nestedPipe.transform(input, mockMetadata);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadRequestException);
      if (error instanceof BadRequestException) {
        const response = error.getResponse() as { message: string[] };
        expect(response.message).toContain("user.profile.email: Invalid email");
      }
    }
  });
});
