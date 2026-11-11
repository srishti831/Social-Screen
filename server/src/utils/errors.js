export class AppError extends Error {
  constructor(message, statusCode = 500, code = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
