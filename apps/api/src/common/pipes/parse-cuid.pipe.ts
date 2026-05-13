import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from "@nestjs/common";

/**
 * Pipe to validate if a string is a valid CUID.
 */
@Injectable()
export class ParseCuidPipe implements PipeTransform<string, string> {
  // CUID v2 regex: starts with a lowercase letter, followed by lowercase letters and numbers
  // Prisma's cuid() implementation currently generates CUID v2
  private readonly cuidRegex = /^[a-z][a-z0-9]*$/;

  transform(value: string, _metadata: ArgumentMetadata): string {
    if (!value || !this.cuidRegex.test(value)) {
      throw new BadRequestException(
        `Invalid ID format. Expected CUID, but received: ${value}`,
      );
    }
    return value;
  }
}
