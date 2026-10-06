/**
 * Creating and editing the material. Instructors and admins only.
 *
 * Writes are narrow on purpose: each one takes the fields it changes rather
 * than a whole row. A service that accepts a row and writes it wholesale lets
 * a form post `status: 'published'` or `createdBy` along with a title change,
 * and nothing in the type system notices.
 */
import { hasAtLeast } from '../ports.js';
import { LmsForbidden, LmsInvalid, LmsNotFound } from '../errors.js';
import { uniqueSlug } from '../slug.js';
function requireRole(context, role, what) {
    if (!hasAtLeast(context.viewer, role))
        throw new LmsForbidden(`Only ${role}s and above may ${what}.`);
}
/** Trims, collapses runs of whitespace, and rejects what is left if empty. */
function requireText(value, field, min = 2, max = 200) {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < min)
        throw new LmsInvalid(`${field} is required.`);
    if (text.length > max)
        throw new LmsInvalid(`${field} is too long (max ${max}).`);
    return text;
}
/**
 * Reads a list field — outcomes, prerequisites, topics, key points.
 *
 * One per line, blanks dropped, trimmed, capped in both length and count. The
 * cap is here rather than in the UI because the UI is not the only caller: an
 * import script is, and an import with one 40,000-character outcome is how a
 * page stops rendering.
 */
export function readList(value, max = 12, maxLength = 300) {
    const lines = Array.isArray(value) ? value : (value ?? '').split('\n');
    return lines
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .slice(0, max)
        .map((line) => line.slice(0, maxLength));
}
export async function createCourse(context, input) {
    requireRole(context, 'instructor', 'create courses');
    const title = requireText(input.title, 'A title');
    const slug = await uniqueSlug(title, (candidate) => context.store.courseSlugExists(candidate));
    const id = context.store.newId();
    await context.store.insertCourse({
        id,
        slug,
        title,
        subtitle: input.subtitle?.trim() || null,
        summary: input.summary?.trim() || null,
        description: input.description?.trim() || null,
        coverImageUrl: input.coverImageUrl?.trim() || null,
        level: input.level ?? 'foundation',
        language: input.language?.trim() || 'English',
        audience: input.audience?.trim() || null,
        outcomes: readList(input.outcomes),
        prerequisites: readList(input.prerequisites),
        topics: readList(input.topics, 10, 40),
        estimatedMinutes: input.estimatedMinutes ?? null,
        createdBy: context.viewer.id,
    });
    // Never published on creation, whatever was passed — the store forces a
    // draft. Publishing is its own call, so a course cannot go live by
    // accident on the way in.
    return { id, slug };
}
export async function updateCourse(context, courseId, input) {
    requireRole(context, 'instructor', 'edit courses');
    const patch = { updatedAt: context.clock.now() };
    if (input.title !== undefined)
        patch.title = requireText(input.title, 'A title');
    if (input.subtitle !== undefined)
        patch.subtitle = input.subtitle?.trim() || null;
    if (input.summary !== undefined)
        patch.summary = input.summary?.trim() || null;
    if (input.description !== undefined)
        patch.description = input.description?.trim() || null;
    if (input.coverImageUrl !== undefined)
        patch.coverImageUrl = input.coverImageUrl?.trim() || null;
    if (input.level !== undefined)
        patch.level = input.level;
    if (input.language !== undefined)
        patch.language = input.language?.trim() || 'English';
    if (input.audience !== undefined)
        patch.audience = input.audience?.trim() || null;
    if (input.outcomes !== undefined)
        patch.outcomes = readList(input.outcomes);
    if (input.prerequisites !== undefined)
        patch.prerequisites = readList(input.prerequisites);
    if (input.topics !== undefined)
        patch.topics = readList(input.topics, 10, 40);
    if (input.estimatedMinutes !== undefined)
        patch.estimatedMinutes = input.estimatedMinutes;
    const changed = await context.store.updateCourse(courseId, patch);
    if (changed === 0)
        throw new LmsNotFound('No such course.');
}
/**
 * Publishes or unpublishes a course.
 *
 * Admin rather than instructor: publishing is what makes material visible to
 * every cohort it is attached to, and an author who can publish their own
 * drafts is an author who can put an unreviewed lesson in front of learners.
 *
 * A course with no published lesson cannot be published. Otherwise a learner
 * is handed a course that opens on an empty outline, which reads as the
 * platform being broken rather than the course being unfinished.
 */
export async function setCourseStatus(context, courseId, status) {
    requireRole(context, 'admin', 'publish courses');
    if (status === 'published' && (await context.store.countPublishedLessons(courseId)) === 0) {
        throw new LmsInvalid('A course needs at least one published lesson before it can be published.');
    }
    const changed = await context.store.setCourseStatus(courseId, status, context.clock.now());
    if (changed === 0)
        throw new LmsNotFound('No such course.');
}
/* --------------------------------------------------------------- modules */
export async function createModule(context, input) {
    requireRole(context, 'instructor', 'add modules');
    const title = requireText(input.title, 'A title');
    if (!(await context.store.findCourseById(input.courseId)))
        throw new LmsNotFound('No such course.');
    const id = context.store.newId();
    await context.store.insertModule({
        id,
        courseId: input.courseId,
        title,
        summary: input.summary?.trim() || null,
        position: input.position ?? (await context.store.nextModulePosition(input.courseId)),
    });
    return { id };
}
export async function updateModule(context, moduleId, input) {
    requireRole(context, 'instructor', 'edit modules');
    const patch = {
        updatedAt: context.clock.now(),
    };
    if (input.title !== undefined)
        patch.title = requireText(input.title, 'A title');
    if (input.summary !== undefined)
        patch.summary = input.summary?.trim() || null;
    if (input.position !== undefined)
        patch.position = input.position;
    const changed = await context.store.updateModule(moduleId, patch);
    if (changed === 0)
        throw new LmsNotFound('No such module.');
}
export async function deleteModule(context, moduleId) {
    requireRole(context, 'admin', 'delete modules');
    await context.store.deleteModule(moduleId);
}
export async function createLesson(context, input) {
    requireRole(context, 'instructor', 'add lessons');
    const title = requireText(input.title, 'A title');
    if (!(await context.store.moduleExists(input.moduleId)))
        throw new LmsNotFound('No such module.');
    // Unique within the module, not globally: two courses may both have an
    // "Introduction", and forcing "introduction-2" on the second one puts the
    // collision in a URL a learner reads.
    const slug = await uniqueSlug(title, (candidate) => context.store.lessonSlugExistsInModule(input.moduleId, candidate));
    const id = context.store.newId();
    await context.store.insertLesson({
        id,
        moduleId: input.moduleId,
        slug,
        title,
        summary: input.summary?.trim() || null,
        kind: input.kind ?? 'video',
        body: input.body ?? null,
        bodyFormat: input.bodyFormat ?? 'markdown',
        keyPoints: readList(input.keyPoints, 8),
        reflectionQuestions: readList(input.reflectionQuestions, 8),
        estimatedMinutes: input.estimatedMinutes ?? null,
        videoRef: input.videoRef?.trim() || null,
        videoStatus: input.videoRef ? 'processing' : 'none',
        position: input.position ?? (await context.store.nextLessonPosition(input.moduleId)),
    });
    return { id, slug };
}
export async function updateLesson(context, lessonId, input) {
    requireRole(context, 'instructor', 'edit lessons');
    const patch = { updatedAt: context.clock.now() };
    if (input.title !== undefined)
        patch.title = requireText(input.title, 'A title');
    if (input.summary !== undefined)
        patch.summary = input.summary?.trim() || null;
    if (input.kind !== undefined)
        patch.kind = input.kind;
    if (input.body !== undefined)
        patch.body = input.body;
    if (input.bodyFormat !== undefined)
        patch.bodyFormat = input.bodyFormat;
    if (input.keyPoints !== undefined)
        patch.keyPoints = readList(input.keyPoints, 8);
    if (input.reflectionQuestions !== undefined)
        patch.reflectionQuestions = readList(input.reflectionQuestions, 8);
    if (input.estimatedMinutes !== undefined)
        patch.estimatedMinutes = input.estimatedMinutes;
    if (input.position !== undefined)
        patch.position = input.position;
    if (input.isPublished !== undefined)
        patch.isPublished = input.isPublished;
    if (input.videoRef !== undefined) {
        patch.videoRef = input.videoRef?.trim() || null;
        patch.videoStatus = input.videoRef ? 'processing' : 'none';
    }
    const changed = await context.store.updateLesson(lessonId, patch);
    if (changed === 0)
        throw new LmsNotFound('No such lesson.');
}
/**
 * Records what the host's video provider has said about a lesson's video.
 *
 * Called from the host's webhook handler. It takes a `videoRef` rather than a
 * lesson id because that is what a provider's callback carries, and it is
 * matched rather than trusted: a callback naming a video this module has
 * never heard of updates nothing instead of creating a row.
 */
export async function recordVideoState(context, input) {
    const updated = await context.store.updateVideoByRef(input.videoRef, {
        status: input.status,
        durationSeconds: input.durationSeconds ?? null,
        thumbnailUrl: input.thumbnailUrl ?? null,
        updatedAt: context.clock.now(),
    });
    return { updated };
}
export async function deleteLesson(context, lessonId) {
    requireRole(context, 'admin', 'delete lessons');
    // Attachments cascade in the database, but the files do not: the host's
    // storage keeps them unless it is asked. Asked here, before the rows go.
    const remove = context.ports.storage?.remove;
    if (remove) {
        for (const file of await context.store.attachmentsFor(lessonId)) {
            try {
                await remove(file.objectKey);
            }
            catch {
                /* A file that cannot be removed must not block deleting the lesson. */
            }
        }
    }
    await context.store.deleteLesson(lessonId);
}
/* ----------------------------------------------------------- attachments */
export async function addAttachment(context, input) {
    requireRole(context, 'instructor', 'add attachments');
    const id = context.store.newId();
    await context.store.insertAttachment({
        id,
        lessonId: input.lessonId,
        label: requireText(input.label, 'A label', 1, 120),
        objectKey: input.objectKey,
        contentType: input.contentType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        createdAt: context.clock.now(),
    });
    return { id };
}
export async function removeAttachment(context, attachmentId) {
    requireRole(context, 'instructor', 'remove attachments');
    const row = await context.store.findAttachment(attachmentId);
    if (!row)
        return;
    await context.store.deleteAttachment(attachmentId);
    const remove = context.ports.storage?.remove;
    if (remove) {
        try {
            await remove(row.objectKey);
        }
        catch {
            /* The row is gone either way; a stranded file is not worth an error. */
        }
    }
}
/* --------------------------------------------------------------- quizzes */
export async function upsertQuiz(context, input) {
    requireRole(context, 'instructor', 'write quizzes');
    const passingScore = Math.min(100, Math.max(1, Math.round(input.passingScore ?? 80)));
    const maxAttempts = Math.max(0, Math.round(input.maxAttempts ?? 3));
    if (input.questions.length === 0)
        throw new LmsInvalid('A quiz needs at least one question.');
    for (const question of input.questions) {
        if (question.options.length < 2)
            throw new LmsInvalid('Each question needs at least two options.');
        const correct = question.options.filter((option) => option.isCorrect).length;
        // Exactly one, because the marker compares a single chosen id against a
        // single correct id. A question with two correct options would mark one
        // of them wrong, and a question with none is unpassable.
        if (correct !== 1)
            throw new LmsInvalid('Each question needs exactly one correct option.');
    }
    if (!(await context.store.findLessonById(input.lessonId)))
        throw new LmsNotFound('No such lesson.');
    const draft = {
        id: context.store.newId(),
        lessonId: input.lessonId,
        title: requireText(input.title, 'A title'),
        instructions: input.instructions?.trim() || null,
        passingScore,
        maxAttempts,
        questions: input.questions.map((question) => ({
            id: context.store.newId(),
            prompt: requireText(question.prompt, 'A question', 2, 1000),
            explanation: question.explanation?.trim() || null,
            options: question.options.map((option, index) => ({
                id: context.store.newId(),
                label: requireText(option.label, 'An option', 1, 500),
                isCorrect: option.isCorrect,
                position: index,
            })),
        })),
    };
    await context.store.replaceQuiz(draft, context.clock.now());
    const stored = await context.store.findQuizByLesson(input.lessonId);
    return { id: stored.id };
}
export async function deleteQuiz(context, quizId) {
    requireRole(context, 'admin', 'delete quizzes');
    await context.store.deleteQuiz(quizId);
}
/** The whole quiz including the answers. Staff only — never for a learner. */
export async function getQuizForEditing(context, lessonId) {
    requireRole(context, 'instructor', 'read quiz answers');
    return context.store.editableQuiz(lessonId);
}
