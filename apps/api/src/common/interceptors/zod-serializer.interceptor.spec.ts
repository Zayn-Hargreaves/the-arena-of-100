import { z } from "zod";
import { ZodSerializerInterceptor } from "./zod-serializer.interceptor";
import { describe, it, expect } from "vitest";
import { of } from "rxjs";
import { ExecutionContext } from "@nestjs/common";

describe("ZodSerializerInterceptor", () => {
  const schema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    // 'password' is intentionally excluded
  });

  const interceptor = new ZodSerializerInterceptor(schema);

  const mockExecutionContext = {} as ExecutionContext;

  it("should serialize a single object and omit extra properties", async () => {
    const rawData = {
      id: "1",
      name: "John Doe",
      email: "john@example.com",
      password: "secretpassword",
    };

    const mockCallHandler = {
      handle: () => of(rawData),
    };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await new Promise((resolve) =>
      observable.subscribe(resolve),
    );

    expect(result).toEqual({
      id: "1",
      name: "John Doe",
      email: "john@example.com",
    });
    expect(result).not.toHaveProperty("password");
  });

  it("should serialize an array of objects and omit extra properties", async () => {
    const rawData = [
      { id: "1", name: "John", email: "john@example.com", password: "p1" },
      { id: "2", name: "Jane", email: "jane@example.com", password: "p2" },
    ];

    const mockCallHandler = {
      handle: () => of(rawData),
    };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = await new Promise((resolve) =>
      observable.subscribe(resolve),
    );

    expect(result).toEqual([
      { id: "1", name: "John", email: "john@example.com" },
      { id: "2", name: "Jane", email: "jane@example.com" },
    ]);
  });

  it("should handle paginated data structures and serialize only the data array", async () => {
    const rawData = {
      data: [
        { id: "1", name: "John", email: "john@example.com", password: "p1" },
      ],
      meta: {
        total: 10,
        page: 1,
        limit: 1,
      },
    };

    const mockCallHandler = {
      handle: () => of(rawData),
    };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = (await new Promise<unknown>((resolve) =>
      observable.subscribe(resolve),
    )) as { data: Record<string, unknown>[]; meta: Record<string, unknown> };

    expect(result.meta).toEqual(rawData.meta);
    expect(result.data).toEqual([
      { id: "1", name: "John", email: "john@example.com" },
    ]);
    expect(result.data[0]).not.toHaveProperty("password");
  });

  it("should handle paginated data structures when data is a single object", async () => {
    const rawData = {
      data: {
        id: "1",
        name: "John",
        email: "john@example.com",
        password: "secret",
      },
      meta: {
        total: 1,
        page: 1,
        limit: 1,
      },
    };

    const mockCallHandler = {
      handle: () => of(rawData),
    };

    const observable = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );
    const result = (await new Promise<unknown>((resolve) =>
      observable.subscribe(resolve),
    )) as { data: Record<string, unknown>; meta: Record<string, unknown> };

    expect(result.meta).toEqual(rawData.meta);
    expect(result.data).toEqual({
      id: "1",
      name: "John",
      email: "john@example.com",
    });
    expect(result.data).not.toHaveProperty("password");
  });

  it("should return null or undefined as is", async () => {
    const mockCallHandler1 = { handle: () => of(null) };
    const mockCallHandler2 = { handle: () => of(undefined) };

    const obs1 = interceptor.intercept(mockExecutionContext, mockCallHandler1);
    const res1 = await new Promise((resolve) => obs1.subscribe(resolve));
    expect(res1).toBeNull();

    const obs2 = interceptor.intercept(mockExecutionContext, mockCallHandler2);
    const res2 = await new Promise((resolve) => obs2.subscribe(resolve));
    expect(res2).toBeUndefined();
  });
});
