import { Request, Response, NextFunction } from 'express';

interface LogData {
  method: string;
  path: string;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  userId?: string;
  statusCode?: number;
  responseBody?: unknown;
  duration?: number;
}

const sanitizeBody = (body: unknown): unknown => {
  if (!body || typeof body !== 'object') return body;

  const sanitized = { ...body as Record<string, unknown> };
  const sensitiveFields = ['password', 'token', 'secret', 'authorization'];

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
};

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  // Log request
  const requestLog: LogData = {
    method: req.method,
    path: req.originalUrl,
  };

  if (Object.keys(req.params).length > 0) {
    requestLog.params = req.params;
  }

  if (Object.keys(req.query).length > 0) {
    requestLog.query = req.query;
  }

  if (req.body && Object.keys(req.body).length > 0) {
    requestLog.body = sanitizeBody(req.body);
  }

  // Get user ID from auth middleware if available
  const authReq = req as Request & { user?: { id: string } };
  if (authReq.user?.id) {
    requestLog.userId = authReq.user.id;
  }

  console.log('[REQ]', JSON.stringify(requestLog));

  // Capture response
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const duration = Date.now() - startTime;

    const responseLog: LogData = {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      duration,
    };

    // Only log response body for non-successful responses or small payloads
    if (res.statusCode >= 400 || (body && JSON.stringify(body).length < 1000)) {
      responseLog.responseBody = body;
    } else {
      responseLog.responseBody = '[truncated]';
    }

    console.log('[RES]', JSON.stringify(responseLog));

    return originalJson(body);
  };

  next();
};
