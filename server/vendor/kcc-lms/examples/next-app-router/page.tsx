/**
 * A learner's shelf.
 *
 * Note what is not here: no entitlement check. `myCourses` only ever returns
 * courses the viewer is entitled to, so there is nothing for a page to get
 * wrong. That is the point of keeping the rule in one place.
 */
import Link from 'next/link';
import { myCourses } from '@kcc/lms';
import { lms } from './lms';

export const dynamic = 'force-dynamic';

export default async function LearnPage() {
  const courses = await myCourses(await lms());

  if (courses.length === 0) {
    return <p>Nothing has been released to you yet.</p>;
  }

  return (
    <ul>
      {courses.map((course) => (
        <li key={course.id}>
          <Link href={`/learn/${course.slug}`}>{course.title}</Link>
          {course.subtitle ? <p>{course.subtitle}</p> : null}
          <p>
            {course.completedCount} of {course.lessonCount} lessons · {course.percent}%
            {course.cohortName ? ` · ${course.cohortName}` : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}
