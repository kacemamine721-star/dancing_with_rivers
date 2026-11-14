import { DataContractError, DataNotFoundError } from '@/data/errors';

/** Map a query error to the right state: not-found → missing, contract → error without retry, network → error with retry. */
export function dataStateForError(error: unknown): { kind: 'missing' | 'error'; retryable: boolean } {
  if (error instanceof DataNotFoundError) return { kind: 'missing', retryable: false };
  if (error instanceof DataContractError) return { kind: 'error', retryable: false };
  return { kind: 'error', retryable: true };
}
