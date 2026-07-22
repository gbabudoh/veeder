import {
  AppError,
  AuthenticationError,
  ConflictError,
  ERROR_CODE_MAX_LENGTH,
  ERROR_MESSAGE_MAX_LENGTH,
  ErrorBody,
  FieldError,
  InternalError,
  NotFoundError,
  RateLimitError,
  TokenError,
  ValidationError,
  toErrorBody,
} from './index';

describe('error taxonomy', () => {
  it('maps each error class to its designed status and code', () => {
    const cases: Array<{ error: AppError; status: number; code: string }> = [
      { error: new ValidationError([]), status: 400, code: 'validation_error' },
      { error: new AuthenticationError(), status: 401, code: 'authentication_failed' },
      { error: new ConflictError(), status: 409, code: 'duplicate_account' },
      { error: new NotFoundError(), status: 404, code: 'account_not_found' },
      { error: new RateLimitError(), status: 429, code: 'rate_limited' },
      { error: new InternalError(), status: 500, code: 'internal_error' },
    ];

    for (const { error, status, code } of cases) {
      expect(error.status).toBe(status);
      expect(error.code).toBe(code);
    }
  });

  it('classifies TokenError reasons to distinct 401 codes', () => {
    expect(new TokenError('missing').code).toBe('auth_required');
    expect(new TokenError('invalid').code).toBe('invalid_token');
    expect(new TokenError('expired').code).toBe('token_expired');
    expect(new TokenError('malformed').code).toBe('token_malformed');
    expect(new TokenError('revoked').code).toBe('invalid_token');
    expect(new TokenError('missing').status).toBe(401);
  });

  it('is a real Error subclass (instanceof + name + message)', () => {
    const error = new ConflictError('duplicate');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.name).toBe('ConflictError');
    expect(error.message).toBe('duplicate');
  });

  it('carries field errors on ValidationError', () => {
    const fields: FieldError[] = [
      { field: 'email', reason: 'invalid format' },
      { field: 'password', reason: 'too short' },
    ];
    const error = new ValidationError(fields);
    expect(error.fields).toEqual(fields);
  });

  it('carries retryAfterSeconds on RateLimitError when provided', () => {
    expect(new RateLimitError('slow down', 30).retryAfterSeconds).toBe(30);
    expect(new RateLimitError().retryAfterSeconds).toBeUndefined();
  });
});

describe('toErrorBody', () => {
  it('serializes only code and message for non-validation errors', () => {
    const body: ErrorBody = toErrorBody(new AuthenticationError());
    expect(body).toEqual({
      error: { code: 'authentication_failed', message: 'Authentication failed' },
    });
    expect(body.error).not.toHaveProperty('fields');
  });

  it('includes fields for validation errors', () => {
    const fields: FieldError[] = [{ field: 'email', reason: 'required' }];
    const body = toErrorBody(new ValidationError(fields));
    expect(body.error.code).toBe('validation_error');
    expect(body.error.fields).toEqual(fields);
  });

  it('matches the instance method output', () => {
    const error = new NotFoundError();
    expect(error.toErrorBody()).toEqual(toErrorBody(error));
  });

  it('produces codes and messages within the Req 9.1 bounds', () => {
    const errors: AppError[] = [
      new ValidationError([{ field: 'email', reason: 'required' }]),
      new AuthenticationError(),
      new TokenError('expired'),
      new ConflictError(),
      new NotFoundError(),
      new RateLimitError(),
      new InternalError(),
    ];
    for (const error of errors) {
      const { code, message } = toErrorBody(error).error;
      expect(code.length).toBeGreaterThanOrEqual(1);
      expect(code.length).toBeLessThanOrEqual(ERROR_CODE_MAX_LENGTH);
      expect(message.length).toBeGreaterThanOrEqual(1);
      expect(message.length).toBeLessThanOrEqual(ERROR_MESSAGE_MAX_LENGTH);
    }
  });
});
