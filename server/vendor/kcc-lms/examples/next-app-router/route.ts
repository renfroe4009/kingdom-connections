/**
 * Recording progress, and mapping the module's errors onto status codes.
 *
 * The lesson id comes from the request, which is exactly why the service
 * checks entitlement rather than trusting the caller: without that, this
 * endpoint awards a learner any lesson whose id they can guess or enumerate.
 */
import { completeLesson, recordWatched, LmsForbidden, LmsNotFound, LmsInvalid, LmsConflict } from '@kcc/lms';
import { lms } from '../lms';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    lessonId?: string;
    secondsWatched?: number;
    lastPositionSeconds?: number;
    complete?: boolean;
  };

  if (!body.lessonId) return Response.json({ error: 'lessonId is required.' }, { status: 400 });

  try {
    const context = await lms();

    if (body.complete) {
      const result = await completeLesson(context, body.lessonId);
      return Response.json(result);
    }

    await recordWatched(context, {
      lessonId: body.lessonId,
      secondsWatched: body.secondsWatched ?? 0,
      lastPositionSeconds: body.lastPositionSeconds ?? 0,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    // `LmsForbidden` means not entitled. Render it as a refusal; do not fall
    // through to a 500, which reads to a client as "retry this".
    if (error instanceof LmsForbidden) return Response.json({ error: error.message }, { status: 403 });
    if (error instanceof LmsNotFound) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof LmsInvalid) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof LmsConflict) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
