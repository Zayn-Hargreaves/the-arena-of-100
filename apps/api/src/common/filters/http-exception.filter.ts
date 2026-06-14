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

  catch(exception: unknown, host: ArgumentsHost): void {
    // WsExceptionFilter owns WebSocket delivery. If we get called
    // for a WS context, defer — otherwise we would attempt
    // `host.switchToHttp()` on a socket and TypeError on
    // `response.status().send()`.
    if (host.getType() !== "http") {
      return;
    }

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

  private getLogMessage(exception: unknown, message: unknown): string {
    if (exception && typeof exception === "object") {
      const err = exception as Record<string, unknown>;
      if (typeof err.stack === "string") return err.stack;
      if (typeof err.message === "string") return err.message;
    }

    if (Array.isArray(message)) {
      return JSON.stringify(message);
    }

    return (message as string) || "Unknown error";
  }
}
