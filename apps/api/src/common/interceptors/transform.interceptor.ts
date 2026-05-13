import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

export interface Response<T, M = unknown> {
  success: boolean;
  message: string;
  data: T;
  meta?: M;
}

// Type guard to check if data is already a wrapped response
function isWrappedResponse(data: unknown): data is Response<unknown> {
  return (
    data !== null &&
    typeof data === "object" &&
    "success" in data &&
    "message" in data &&
    typeof (data as Record<string, unknown>).success === "boolean" &&
    typeof (data as Record<string, unknown>).message === "string"
  );
}

// Type guard to check if data has the expected pagination structure
function hasPaginationStructure(data: unknown): data is { data: unknown; meta: unknown } {
  return (
    data !== null &&
    typeof data === "object" &&
    "data" in data &&
    "meta" in data
  );
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => {
        // If the response is already wrapped with success/message, return as-is
        if (isWrappedResponse(data)) {
          return data as Response<T>;
        }

        // If the response has data and meta (like pagination)
        if (hasPaginationStructure(data)) {
          return {
            success: true,
            message: "Success",
            data: data.data as T, // We've validated the structure, so we can safely cast
            meta: data.meta,
          };
        }

        return {
          success: true,
          message: "Success",
          data: data as T, // Direct assignment for non-paginated data
        };
      }),
    );
  }
}
