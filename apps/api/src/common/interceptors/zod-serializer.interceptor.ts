import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UseInterceptors,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { ZodSchema } from "zod";

/**
 * NestJS interceptor to serialize outgoing payloads using Zod schemas.
 * This completely decouples presentation serialization from internal database entities.
 */
@Injectable()
export class ZodSerializerInterceptor implements NestInterceptor {
  constructor(private readonly schema: ZodSchema) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (data === null || data === undefined) {
          return data;
        }

        // If the return data is a pagination envelope, serialize the inside "data" array/object
        if (
          typeof data === "object" &&
          "data" in data &&
          "meta" in data &&
          data.data !== null &&
          typeof data.data === "object"
        ) {
          const serializedData = Array.isArray(data.data)
            ? data.data.map((item: unknown) => this.schema.parse(item))
            : this.schema.parse(data.data);

          return {
            ...data,
            data: serializedData,
          };
        }

        // Standard array/object serialization
        if (Array.isArray(data)) {
          return data.map((item: unknown) => this.schema.parse(item));
        }

        return this.schema.parse(data);
      }),
    );
  }
}

/**
 * Custom decorator to apply Zod response serialization.
 */
export const ZodSerialize = (schema: ZodSchema) =>
  UseInterceptors(new ZodSerializerInterceptor(schema));
