import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from "@nestjs/common";
import { ZodSchema, ZodError } from "zod";

/**
 * Custom error formatter for Zod validation errors.
 * Converts ZodError to a string[] of "field: message" matching Nest's default format.
 */
export function formatZodError(error: ZodError): string[] {
  return error.errors.map((issue) => {
    const path = issue.path.join(".");
    const fieldPrefix = path ? `${path}: ` : "";
    return `${fieldPrefix}${issue.message}`;
  });
}

/**
 * NestJS Validation Pipe that uses Zod schemas to validate incoming payloads.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const formattedErrors = formatZodError(result.error);
      throw new BadRequestException(formattedErrors);
    }

    return result.data;
  }
}
