/**
 * What a learner reads: their courses, a course outline, a lesson.
 *
 * Every read here goes through `entitlement()` in `enrolment.ts` rather than
 * writing its own join, so there is one answer to "may this person see this"
 * and no screen can widen it.
 */
import { LmsForbidden, LmsNotFound } from '../errors.js';
import { entitlement, requireEntitlement } from './enrolment.js';
/** The courses on this learner's shelf, with how far through each they are. */
export async function myCourses(context) {
    const rows = await context.store.shelfFor(context.viewer.id);
    const now = context.clock.now();
    // A learner can sit in more than one cohort holding the same course. Show
    // it once, and only if it is actually open.
    const unique = new Map();
    for (const row of rows) {
        if (row.availableFrom !== null && row.availableFrom > now)
            continue;
        if (!unique.has(row.id))
            unique.set(row.id, row);
    }
    const list = [...unique.values()];
    if (list.length === 0)
        return [];
    const stats = await courseProgress(context, context.viewer.id, list.map((row) => row.id));
    return list.map((row) => {
        const stat = stats.get(row.id) ?? { lessonCount: 0, completedCount: 0, percent: 0 };
        return {
            id: row.id,
            slug: row.slug,
            title: row.title,
            subtitle: row.subtitle,
            summary: row.summary,
            coverImageUrl: row.coverImageUrl,
            cohortName: row.cohortName,
            ...stat,
        };
    });
}
/** How far through each course somebody is. Counts published lessons only. */
export async function courseProgress(context, userId, courseIds) {
    if (userId !== context.viewer.id && context.viewer.role === 'learner') {
        throw new LmsForbidden('You can only see your own progress.');
    }
    const counts = await context.store.progressCounts(userId, courseIds);
    const out = new Map();
    for (const [courseId, stat] of counts) {
        out.set(courseId, {
            ...stat,
            percent: stat.lessonCount === 0 ? 0 : Math.round((stat.completedCount / stat.lessonCount) * 100),
        });
    }
    return out;
}
/**
 * A course and its outline, by slug.
 *
 * Draft lessons are hidden from learners and shown to staff, which is what
 * lets an author see their work in the shape a learner will see it.
 */
export async function getCourse(context, slug) {
    const course = await context.store.findCourseBySlug(slug);
    if (!course)
        return null;
    await requireEntitlement(context, course.id);
    const staff = context.viewer.role !== 'learner';
    const outline = await context.store.outlineFor(course.id, context.viewer.id);
    const byModule = new Map();
    let lessonCount = 0;
    let completedCount = 0;
    let nextLessonSlug = null;
    for (const row of outline) {
        if (!byModule.has(row.moduleId)) {
            byModule.set(row.moduleId, {
                id: row.moduleId,
                title: row.moduleTitle,
                summary: row.moduleSummary,
                position: row.modulePosition,
                lessons: [],
            });
        }
        if (!row.lessonId)
            continue;
        if (!row.isPublished && !staff)
            continue;
        const isCompleted = row.completedAt !== null;
        byModule.get(row.moduleId).lessons.push({
            id: row.lessonId,
            slug: row.lessonSlug,
            title: row.lessonTitle,
            summary: row.lessonSummary,
            kind: row.lessonKind,
            estimatedMinutes: row.lessonMinutes,
            position: row.lessonPosition,
            hasQuiz: row.hasQuiz,
            isCompleted,
        });
        if (row.isPublished) {
            lessonCount += 1;
            if (isCompleted)
                completedCount += 1;
            else if (!nextLessonSlug)
                nextLessonSlug = row.lessonSlug;
        }
    }
    return {
        id: course.id,
        slug: course.slug,
        title: course.title,
        subtitle: course.subtitle,
        summary: course.summary,
        description: course.description,
        coverImageUrl: course.coverImageUrl,
        level: course.level,
        language: course.language,
        audience: course.audience,
        outcomes: course.outcomes,
        prerequisites: course.prerequisites,
        topics: course.topics,
        estimatedMinutes: course.estimatedMinutes,
        modules: [...byModule.values()],
        lessonCount,
        completedCount,
        percent: lessonCount === 0 ? 0 : Math.round((completedCount / lessonCount) * 100),
        nextLessonSlug,
    };
}
/**
 * One lesson, ready to play.
 *
 * The signed video token and the attachment URLs are minted here, after
 * entitlement has been checked, and only here. That ordering is the point:
 * handing out a playback token before checking entitlement is handing out
 * the lesson, whatever the page then renders.
 */
export async function getLesson(context, courseSlug, lessonSlug) {
    const found = await context.store.findLessonBySlug(courseSlug, lessonSlug);
    if (!found)
        return null;
    await requireEntitlement(context, found.courseId);
    const staff = context.viewer.role !== 'learner';
    if (!found.lesson.isPublished && !staff)
        throw new LmsNotFound('No such lesson.');
    const progress = await context.store.findProgress(context.viewer.id, found.lesson.id);
    const attachmentRows = await context.store.attachmentsFor(found.lesson.id);
    /*
     * With no storage port, attachments are withheld rather than returned with
     * their raw object key: a key is not a URL, and a host that has not wired
     * storage up should get nothing rather than something broken.
     */
    const storage = context.ports.storage;
    const attachments = storage
        ? await Promise.all(attachmentRows.map(async (row) => ({
            id: row.id,
            label: row.label,
            url: await storage.signedUrl(row.objectKey, 3600),
            contentType: row.contentType,
            sizeBytes: row.sizeBytes,
        })))
        : [];
    let video = null;
    if (found.lesson.videoRef && context.ports.video) {
        video = await context.ports.video.playback(found.lesson.videoRef);
    }
    const quiz = await context.store.findQuizByLesson(found.lesson.id);
    const { previousSlug, nextSlug } = await neighbours(context, found.courseId, found.lesson.id, staff);
    return {
        id: found.lesson.id,
        slug: found.lesson.slug,
        title: found.lesson.title,
        summary: found.lesson.summary,
        kind: found.lesson.kind,
        body: found.lesson.body,
        bodyFormat: found.lesson.bodyFormat,
        keyPoints: found.lesson.keyPoints,
        reflectionQuestions: found.lesson.reflectionQuestions,
        estimatedMinutes: found.lesson.estimatedMinutes,
        courseId: found.courseId,
        courseSlug: found.courseSlug,
        courseTitle: found.courseTitle,
        moduleTitle: found.moduleTitle,
        video,
        videoStatus: found.lesson.videoStatus,
        videoDurationSeconds: found.lesson.videoDurationSeconds,
        attachments,
        hasQuiz: quiz !== null,
        progress: progress
            ? {
                status: progress.status,
                lastPositionSeconds: progress.lastPositionSeconds,
                completedAt: progress.completedAt,
            }
            : null,
        previousSlug,
        nextSlug,
    };
}
/** The lesson either side of this one, in course order. */
async function neighbours(context, courseId, lessonId, staff) {
    const sequence = await context.store.lessonSequence(courseId);
    const visible = sequence.filter((row) => staff || row.isPublished);
    const index = visible.findIndex((row) => row.id === lessonId);
    if (index === -1)
        return { previousSlug: null, nextSlug: null };
    return {
        previousSlug: index > 0 ? visible[index - 1].slug : null,
        nextSlug: index < visible.length - 1 ? visible[index + 1].slug : null,
    };
}
/** Whether a viewer may open a course, without loading it. For route guards. */
export async function canOpen(context, courseId) {
    return (await entitlement(context, courseId)).allowed;
}
