import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import { socialKeys } from '@/lib/social-queries';
import { PostCard } from './PostCard';

/** /p/:id — a shareable single post (the "Copy link" destination). */
export function PostPage() {
  const { id = '' } = useParams();
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: socialKeys.post(id), queryFn: () => api.post(id) });
  return (
    <div className="mx-auto max-w-2xl">
      <Button asChild variant="quiet" size="sm" className="mb-3">
        <Link to="/home">
          <ArrowLeft /> Feed
        </Link>
      </Button>
      {isPending ? (
        <PageLoading />
      ) : isError ? (
        error instanceof ApiRequestError && error.status === 404 ? (
          <div className="py-16 text-center">
            <h1 className="text-2xl font-bold">This post isn't available</h1>
            <p className="mt-2 text-sm text-text-2">It may have been deleted.</p>
          </div>
        ) : (
          <LoadFailed message={errorMessage(error)} onRetry={() => void refetch()} />
        )
      ) : (
        <PostCard post={data} />
      )}
    </div>
  );
}
