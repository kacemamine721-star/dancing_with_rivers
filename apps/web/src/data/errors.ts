import type { ZodIssue } from 'zod';

/** A bundle file did not match its contract (contracts/*.schema.json). The layer is hidden, the act goes on. */
export class DataContractError extends Error {
  override readonly name = 'DataContractError';
  constructor(
    readonly contract: string,
    readonly url: string,
    readonly issues: readonly ZodIssue[],
  ) {
    super(
      `${contract}: ${url} does not match its contract (${issues.length} issue${issues.length === 1 ? '' : 's'}: ` +
        issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || '<root>'} ${i.message}`)
          .join('; ') +
        ')',
    );
  }
}

/** The file is not in the bundle (404) or the dam is not covered: show `<DataState kind="missing">`. */
export class DataNotFoundError extends Error {
  override readonly name = 'DataNotFoundError';
  constructor(
    readonly contract: string,
    readonly url: string,
    message?: string,
  ) {
    super(message ?? `${contract}: ${url} is not in the data bundle`);
  }
}

/** Network or HTTP failure: show a retry. */
export class DataFetchError extends Error {
  override readonly name = 'DataFetchError';
  constructor(
    readonly contract: string,
    readonly url: string,
    readonly status: number | null,
    options?: { cause?: unknown },
  ) {
    super(`${contract}: failed to load ${url}${status === null ? '' : ` (HTTP ${status})`}`, options);
  }
}

export type DataError = DataContractError | DataNotFoundError | DataFetchError;

/** Errors that a retry cannot fix. */
export function isPermanentDataError(e: unknown): boolean {
  return e instanceof DataContractError || e instanceof DataNotFoundError;
}
