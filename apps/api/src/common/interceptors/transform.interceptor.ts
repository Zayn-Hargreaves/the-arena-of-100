import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

export interface Response<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: unknown;
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
        // If the response already has data and meta (like pagination)
        if (
          data &&
          typeof data === "object" &&
          "data" in data &&
          "meta" in data
        ) {
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
          data: data,
        };
      }),
    );
  }
}
