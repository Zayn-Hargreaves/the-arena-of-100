import { TransformInterceptor, Response } from "./transform.interceptor";
import { of } from "rxjs";
import { ExecutionContext } from "@nestjs/common";

describe("TransformInterceptor", () => {
  let interceptor: TransformInterceptor<unknown>;
  const mockContext = {} as ExecutionContext;

  beforeEach(() => {
    interceptor = new TransformInterceptor();
  });

  it("should wrap plain data with default success and message", () => {
    const testData = { id: 1, name: "test" };
    const callHandler = {
      handle: () => of(testData),
    };

    return new Promise<void>((resolve) => {
      interceptor.intercept(mockContext, callHandler).subscribe((result) => {
        expect(result).toEqual({
          success: true,
          message: "Success",
          data: testData,
        });
        resolve();
      });
    });
  });

  it("should preserve already wrapped responses", () => {
    const testData: Response<unknown> = {
      success: false,
      message: "Custom error message",
      data: { error: "something went wrong" },
    };

    const callHandler = {
      handle: () => of(testData),
    };

    return new Promise<void>((resolve) => {
      interceptor.intercept(mockContext, callHandler).subscribe((result) => {
        expect(result).toBe(testData); // Should return as-is
        resolve();
      });
    });
  });

  it("should handle paginated data correctly", () => {
    const testData = {
      data: [
        { id: 1, name: "item1" },
        { id: 2, name: "item2" },
      ],
      meta: { totalCount: 2, page: 1 },
    };

    const callHandler = {
      handle: () => of(testData),
    };

    return new Promise<void>((resolve) => {
      interceptor.intercept(mockContext, callHandler).subscribe((result) => {
        expect(result).toEqual({
          success: true,
          message: "Success",
          data: testData.data,
          meta: testData.meta,
        });
        resolve();
      });
    });
  });
});
