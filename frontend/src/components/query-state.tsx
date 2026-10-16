/**
 * @file Small shared rendering boundary for React Query loading/error states. Views continue
 * rendering their actual data separately; this component reports activity with role=status and
 * failures with role=alert.
 */

/**
 * Render loading first, then the useful API error message, or nothing once neither state
 * applies; do not invent an empty-data state.
 */
export function QueryState({ pending, error }: { pending: boolean; error: Error | null }) {
  if (pending)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Loading...
      </p>
    );
  if (error)
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {error.message}
      </p>
    );
  return null;
}
