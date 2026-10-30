export class AppError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {number} statusCode
   * @param {any} [details]
   */
  constructor(message, code = 'internal_error', statusCode = 500, details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details = undefined) {
    super(message, 'not_found', 404, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Invalid request', details = undefined) {
    super(message, 'invalid_request', 400, details);
  }
}

export class PortalAuthError extends AppError {
  constructor(message = 'Failed to authenticate with upstream portal', details = undefined) {
    super(message, 'portal_auth_error', 502, details);
  }
}

export class PortalUnavailableError extends AppError {
  constructor(message = 'Upstream portal is currently unavailable', details = undefined) {
    super(message, 'upstream_unavailable', 503, details);
  }
}

export class PortalTimeoutError extends AppError {
  constructor(message = 'Upstream portal request timed out', details = undefined) {
    super(message, 'upstream_timeout', 504, details);
  }
}

export class PortalProtocolError extends AppError {
  constructor(message = 'Upstream portal returned unexpected response', details = undefined) {
    super(message, 'upstream_error', 502, details);
  }
}

export class ConfigError extends AppError {
  constructor(message) {
    super(message, 'config_error', 500);
  }
}
