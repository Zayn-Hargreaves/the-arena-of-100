import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { HttpExceptionBody } from "@nestjs/common/interfaces/http/http-exception-body.interface";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: "Internal server error" };

    const message =
      typeof exceptionResponse === "object" && exceptionResponse !== null
        ? (exceptionResponse as HttpExceptionBody).message ||
          (exceptionResponse as HttpExceptionBody).error ||
          "Internal server error"
        : exceptionResponse;

    const errorResponse = {
      success: false,
      error: {
        statusCode: status,
        message: message, // Preserve array for validation errors
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    };

    // Log the error
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${status} - ${typeof exception === "object" && exception !== null && "stack" in exception ? (exception as Error).stack : typeof exception === "object" && exception !== null && "message" in exception ? (exception as Error).message : "Unknown error"}`,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} ${status} - ${Array.isArray(message) ? JSON.stringify(message) : message}`,
      );
    }

    response.status(status).send(errorResponse);
  }
}
