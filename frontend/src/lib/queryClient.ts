// One QueryClient, importable outside React. The websocket store lives outside
// the component tree but has to invalidate caches when the server pushes a new
// event, and `useQueryClient()` needs a hook to reach. This is that client.
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});
