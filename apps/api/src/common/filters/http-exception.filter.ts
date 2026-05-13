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
        message: message, // Mirrors extracted message (string or string[])
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    };

    // Log the error
    const logMessage = this.getLogMessage(
      status >= 500 ? exception : null,
      message,
    );
    const logInfo = `${request.method} ${request.url} ${status} - ${logMessage}`;

    if (status >= 500) {
      this.logger.error(logInfo);
    } else {
      this.logger.warn(logInfo);
    }

    response.status(status).send(errorResponse);
  }

  private getLogMessage(exception: any, message: any): string {
    if (exception && typeof exception === "object") {
      if ("stack" in exception && exception.stack) return exception.stack;
      if ("message" in exception && exception.message) return exception.message;
    }

    if (Array.isArray(message)) {
      return JSON.stringify(message);
    }

    return (message as string) || "Unknown error";
  }
}
