/**
 * Shown instead of React Router's raw "Unexpected Application Error!" screen when a page crashes
 * or fails to load. Kept out of lazy chunks so it always works.
 */
import { RefreshCw } from 'lucide-react';
import { useRouteError } from 'react-router-dom';
import { LogoMark } from '@/components/common/Logo';
import { Button } from '@/components/common/ui';
import { isChunkError } from '@/utils/chunkReload';

export function RouteError() {
  const err = useRouteError();
  const newVersion = isChunkError(err);
  if (!newVersion) console.error(err);
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <LogoMark className="h-10 w-10" />
        <h1 className="text-xl font-bold">{newVersion ? 'VertexLearn was updated' : 'Something went wrong'}</h1>
        <p className="text-sm text-muted">
          {newVersion
            ? 'A newer version is available. Reload to continue — you will stay signed in.'
            : 'This page hit an unexpected error. Reloading usually fixes it. If it keeps happening, please let us know.'}
        </p>
        <div className="mt-2 flex gap-2">
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="outline" onClick={() => window.location.assign('/')}>Go home</Button>
        </div>
      </div>
    </div>
  );
}
