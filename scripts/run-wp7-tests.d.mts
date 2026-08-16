/**
 * Type declarations for the WP-7 validated test runner (TEST-INFRA).
 *
 * Allows TypeScript tests (tests/unit/mac3b-accounting.test.ts) to import
 * the runner's exported accounting helpers with full typing. Runtime
 * behavior lives entirely in run-wp7-tests.mjs; this file is inert at
 * runtime.
 */
export interface TapSummary {
  readonly tests: number;
  readonly pass: number;
  readonly fail: number;
  readonly cancelled: number;
  readonly skipped: number;
  readonly todo: number;
}

export type ParseTapResult =
  | { readonly ok: true; readonly summary: TapSummary }
  | { readonly ok: false; readonly error: string };

export type EvaluateResult = {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly summary: TapSummary | null;
};

export const EXPECTED_COUNTS: Readonly<{ reader: number; git: number; fff: number; security: number }>;

export const PERMITTED_SKIPS: Readonly<{
  reader: Readonly<Record<string, readonly string[]>>;
  git: Readonly<Record<string, readonly string[]>>;
  fff: Readonly<Record<string, readonly string[]>>;
  security: Readonly<Record<string, readonly string[]>>;
}>;

export function parseTapSummary(stdout: string): ParseTapResult;

export function parseSkippedNames(stdout: string): string[];

export function evaluateSuite(
  name: string,
  expected: number,
  status: number,
  stdout: string,
  permittedSkips?: readonly string[],
): EvaluateResult;
