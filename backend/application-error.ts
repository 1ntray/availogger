// Only explicitly safe messages may cross the application API boundary.
export class ApplicationError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly retryAfterSeconds?: number) {
    super(message);
  }
}
