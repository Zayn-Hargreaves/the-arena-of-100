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
function hasPaginationStructure<T, M>(
  data: unknown,
): data is { data: T; meta: M } {
  if (data === null || typeof data !== "object") {
    return false;
  }

  const record = data as Record<string, unknown>;

  if (!("data" in record) || !("meta" in record)) {
    return false;
  }

  const dataProp = record.data;
  const metaProp = record.meta;

  // data should be an object or array (not a primitive string/number/boolean/null)
  const isDataValid = dataProp !== null && typeof dataProp === "object";

  // meta should be a non-null object
  const isMetaValid = metaProp !== null && typeof metaProp === "object";

  if (!isDataValid || !isMetaValid) {
    return false;
  }

  const meta = metaProp as Record<string, unknown>;

  return ["total", "page", "limit", "totalCount", "perPage"].some(
    (key) => typeof meta[key] === "number",
  );
}

@Injectable()
export class TransformInterceptor<T, M = unknown> implements NestInterceptor<
  T | { data: T; meta: M },
  Response<T, M>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T, M>> {
    return next.handle().pipe(
      map((data) => {
        // If the response is already wrapped with success/message, return as-is
        if (isWrappedResponse(data)) {
          return data as Response<T, M>;
        }

        // If the response has data and meta (like pagination)
        if (hasPaginationStructure<T, M>(data)) {
          return {
            success: true,
            message: "Success",
            data: data.data,
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
