/**
 * One Store implementation, for both dialects.
 *
 * It takes the database handle, the dialect's tables and a `Dialect`, so
 * everything except the five operations in `./dialect.ts` is written once.
 *
 * **On the loose typing of `tables`.** Drizzle's Postgres and MySQL table
 * builders produce different types, so a single function cannot be strongly
 * typed over both without a layer of generics that would obscure every query
 * in this file. The types are deliberately spent elsewhere: `Store` is fully
 * typed, so the services — where the rules are — are checked against a real
 * contract, and the probe suite runs this file against both engines. Spending
 * the type safety here instead would buy less and cost more.
 */
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { likePattern } from '../like.js';
/**
 * Rows from a raw `execute`, whichever driver is underneath.
 *
 * Three shapes, and all three are real:
 *
 *   - **node-postgres** returns a result object with a `rows` array.
 *   - **postgres-js** returns the array of rows itself.
 *   - **mysql2** returns a two-element tuple, `[rows, fields]`.
 *
 * The tuple is the one that bites, because it is an array and so looks like
 * the postgres-js case: taking it as the rows yields two "rows", the first
 * being the real array and the second a block of column metadata. What
 * distinguishes them is that a row is an object and never an array, so an
 * array at index 0 means a tuple.
 */
function resultRows(result) {
    if (Array.isArray(result)) {
        if (result.length > 0 && Array.isArray(result[0]))
            return result[0];
        return result;
    }
    const rows = result.rows;
    return Array.isArray(rows) ? rows : [];
}
/**
 * MySQL's `json` columns come back parsed by mysql2, but a column declared
 * `longtext` by an older migration comes back as a string. Both are tolerated
 * rather than assumed, because the failure is a page that renders `[object
 * Object]` or throws on `.map`.
 */
function asList(value) {
    if (Array.isArray(value))
        return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    return [];
}
/** MySQL returns tinyint(1) for a boolean; Postgres returns a boolean. */
function asBool(value) {
    return value === true || value === 1 || value === '1';
}
function asNumber(value) {
    return typeof value === 'number' ? value : Number(value ?? 0);
}
/**
 * A date out of the database.
 *
 * mysql2 hands back a `Date` for `timestamp` columns when the connection is
 * configured for it and a string otherwise, so neither is assumed. See the
 * timestamp note in `../schema/mysql.ts`: the connection must be in UTC, or
 * the instants are wrong by the host's offset and nothing here can tell.
 */
function asDate(value) {
    if (value === null || value === undefined)
        return null;
    if (value instanceof Date)
        return value;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
export function drizzleStore(input) {
    const { db, tables: t, dialect } = input;
    const newId = input.newId ?? (() => crypto.randomUUID());
    const count = () => dialect.countInt();
    const courseOut = (row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        subtitle: row.subtitle ?? null,
        summary: row.summary ?? null,
        description: row.description ?? null,
        coverImageUrl: row.coverImageUrl ?? null,
        status: row.status,
        estimatedMinutes: row.estimatedMinutes === null ? null : asNumber(row.estimatedMinutes),
        level: row.level,
        language: row.language,
        audience: row.audience ?? null,
        outcomes: asList(row.outcomes),
        prerequisites: asList(row.prerequisites),
        topics: asList(row.topics),
        createdBy: row.createdBy ?? null,
    });
    const lessonOut = (row) => ({
        id: row.id,
        moduleId: row.moduleId,
        slug: row.slug,
        title: row.title,
        summary: row.summary ?? null,
        kind: row.kind,
        body: row.body ?? null,
        bodyFormat: row.bodyFormat,
        keyPoints: asList(row.keyPoints),
        reflectionQuestions: asList(row.reflectionQuestions),
        estimatedMinutes: row.estimatedMinutes === null ? null : asNumber(row.estimatedMinutes),
        videoRef: row.videoRef ?? null,
        videoStatus: row.videoStatus,
        videoDurationSeconds: row.videoDurationSeconds === null ? null : asNumber(row.videoDurationSeconds),
        videoThumbnailUrl: row.videoThumbnailUrl ?? null,
        position: asNumber(row.position),
        isPublished: asBool(row.isPublished),
    });
    const cohortOut = (row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description ?? null,
        status: row.status,
        startsOn: asDate(row.startsOn),
        endsOn: asDate(row.endsOn),
    });
    /**
     * How many rows an update touched, which the two drivers report in
     * incompatible shapes — and one of them lies.
     *
     * node-postgres gives a result object with `rowCount`. mysql2 gives the
     * tuple `[ResultSetHeader, fields]`, and the header's `affectedRows` is
     * the number of rows **changed**, not matched: by default MySQL reports 0
     * for an update that sets a column to the value it already held. So a
     * caller renaming a course to its current name would be told the course
     * does not exist.
     *
     * Hence `touched()` below, which treats 0 as "ask whether the row is
     * there" rather than as "it is not". Reading the tuple's length as the
     * count — which is what this did at first — returns 2 for every update,
     * including ones that matched nothing, and a caller that uses the count to
     * detect a missing row stops detecting it.
     */
    const changed = (result) => {
        if (Array.isArray(result)) {
            const header = result[0];
            if (header && typeof header.affectedRows === 'number')
                return header.affectedRows;
            return 0;
        }
        if (typeof result?.rowCount === 'number')
            return result.rowCount;
        if (typeof result?.rowsAffected === 'number')
            return result.rowsAffected;
        if (typeof result?.affectedRows === 'number')
            return result.affectedRows;
        return 0;
    };
    /**
     * Whether an update found its row.
     *
     * Returns 1 when the row exists, whether or not anything about it changed,
     * and 0 only when it is genuinely absent. Both halves are needed: the
     * driver's count alone is wrong on MySQL for a no-op update, and the
     * existence check alone would cost a query on every successful write.
     */
    const touched = async (result, table, where) => {
        if (changed(result) > 0)
            return 1;
        return (await exists(table, where)) ? 1 : 0;
    };
    /**
     * An upsert, spelled for whichever dialect is underneath.
     *
     * The two builders take different methods and different shapes, and the
     * wrong one is a silent duplicate-key error on the engine you did not
     * test. This is the only place that difference exists.
     */
    const upsert = async (table, values, conflictColumns, set) => {
        const insert = db.insert(table).values(values);
        if (dialect.name === 'mysql') {
            await insert.onDuplicateKeyUpdate({ set });
            return;
        }
        await insert.onConflictDoUpdate({ target: conflictColumns, set });
    };
    const insertIgnore = async (table, values, conflictColumns) => {
        const insert = db.insert(table).values(values);
        if (dialect.name === 'mysql') {
            // MySQL has no "do nothing"; re-setting a column to itself is the
            // idiom, and is cheaper than a select-then-insert race.
            await insert.onDuplicateKeyUpdate({ set: values });
            return;
        }
        await insert.onConflictDoNothing({ target: conflictColumns });
    };
    const exists = async (table, where) => {
        const rows = await db.select({ one: sql `1` }).from(table).where(where).limit(1);
        return rows.length > 0;
    };
    return {
        newId,
        /* ----------------------------------------------------------- courses */
        async findCourseById(id) {
            const [row] = await db.select().from(t.courses).where(eq(t.courses.id, id)).limit(1);
            return row ? courseOut(row) : null;
        },
        async findCourseBySlug(slug) {
            const [row] = await db.select().from(t.courses).where(eq(t.courses.slug, slug)).limit(1);
            return row ? courseOut(row) : null;
        },
        courseSlugExists(slug) {
            return exists(t.courses, eq(t.courses.slug, slug));
        },
        async allCourseIds() {
            const rows = await db.select({ id: t.courses.id }).from(t.courses);
            return rows.map((row) => row.id);
        },
        async insertCourse(course) {
            await db.insert(t.courses).values({ ...course, status: 'draft' });
        },
        async updateCourse(id, patch) {
            const result = await db.update(t.courses).set(patch).where(eq(t.courses.id, id));
            return touched(result, t.courses, eq(t.courses.id, id));
        },
        async setCourseStatus(id, status, updatedAt) {
            const result = await db.update(t.courses).set({ status, updatedAt }).where(eq(t.courses.id, id));
            return touched(result, t.courses, eq(t.courses.id, id));
        },
        async countPublishedLessons(courseId) {
            const [row] = await db
                .select({ count: count() })
                .from(t.lessons)
                .innerJoin(t.modules, eq(t.modules.id, t.lessons.moduleId))
                .where(and(eq(t.modules.courseId, courseId), eq(t.lessons.isPublished, true)));
            return asNumber(row?.count);
        },
        /* ----------------------------------------------------------- cohorts */
        async listCohortsWithCounts() {
            const rows = await db
                .select({
                id: t.cohorts.id,
                name: t.cohorts.name,
                slug: t.cohorts.slug,
                description: t.cohorts.description,
                status: t.cohorts.status,
                startsOn: t.cohorts.startsOn,
                endsOn: t.cohorts.endsOn,
            })
                .from(t.cohorts)
                // Name then id: two cohorts may share a name across two years, and a
                // tie the database orders differently between queries loses one.
                .orderBy(asc(t.cohorts.name), asc(t.cohorts.id));
            if (rows.length === 0)
                return [];
            const ids = rows.map((row) => row.id);
            const [memberCounts, courseCounts] = await Promise.all([
                db
                    .select({ cohortId: t.cohortMembers.cohortId, count: count() })
                    .from(t.cohortMembers)
                    .where(inArray(t.cohortMembers.cohortId, ids))
                    .groupBy(t.cohortMembers.cohortId),
                db
                    .select({ cohortId: t.cohortCourses.cohortId, count: count() })
                    .from(t.cohortCourses)
                    .where(inArray(t.cohortCourses.cohortId, ids))
                    .groupBy(t.cohortCourses.cohortId),
            ]);
            const members = new Map(memberCounts.map((r) => [r.cohortId, asNumber(r.count)]));
            const courses = new Map(courseCounts.map((r) => [r.cohortId, asNumber(r.count)]));
            return rows.map((row) => ({
                ...cohortOut(row),
                memberCount: members.get(row.id) ?? 0,
                courseCount: courses.get(row.id) ?? 0,
            }));
        },
        async findCohortById(id) {
            const [row] = await db.select().from(t.cohorts).where(eq(t.cohorts.id, id)).limit(1);
            return row ? cohortOut(row) : null;
        },
        cohortSlugExists(slug) {
            return exists(t.cohorts, eq(t.cohorts.slug, slug));
        },
        async insertCohort(cohort) {
            await db.insert(t.cohorts).values(cohort);
        },
        async addCohortMember(cohortId, userId, joinedAt) {
            await insertIgnore(t.cohortMembers, { cohortId, userId, joinedAt }, [
                t.cohortMembers.cohortId,
                t.cohortMembers.userId,
            ]);
        },
        async removeCohortMember(cohortId, userId) {
            await db
                .delete(t.cohortMembers)
                .where(and(eq(t.cohortMembers.cohortId, cohortId), eq(t.cohortMembers.userId, userId)));
        },
        async cohortMemberIds(cohortId) {
            const rows = await db
                .select({ userId: t.cohortMembers.userId })
                .from(t.cohortMembers)
                .where(eq(t.cohortMembers.cohortId, cohortId));
            return rows.map((row) => row.userId);
        },
        async cohortsForUser(userId) {
            const rows = await db
                .select({ id: t.cohorts.id, name: t.cohorts.name })
                .from(t.cohortMembers)
                .innerJoin(t.cohorts, eq(t.cohorts.id, t.cohortMembers.cohortId))
                .where(eq(t.cohortMembers.userId, userId))
                .orderBy(asc(t.cohorts.name), asc(t.cohorts.id));
            return rows.map((row) => ({ id: row.id, name: row.name }));
        },
        /* ------------------------------------------------------- entitlement */
        async releasesFor(userId, courseId) {
            const rows = await db
                .select({
                cohortId: t.cohortCourses.cohortId,
                availableFrom: t.cohortCourses.availableFrom,
            })
                .from(t.cohortMembers)
                .innerJoin(t.cohortCourses, eq(t.cohortCourses.cohortId, t.cohortMembers.cohortId))
                .where(and(eq(t.cohortMembers.userId, userId), eq(t.cohortCourses.courseId, courseId)));
            return rows.map((row) => ({ cohortId: row.cohortId, availableFrom: asDate(row.availableFrom) }));
        },
        async openCourseIdsFor(userId, now) {
            const rows = await db
                .selectDistinct({ id: t.courses.id })
                .from(t.cohortMembers)
                .innerJoin(t.cohortCourses, eq(t.cohortCourses.cohortId, t.cohortMembers.cohortId))
                .innerJoin(t.courses, eq(t.courses.id, t.cohortCourses.courseId))
                .where(and(eq(t.cohortMembers.userId, userId), eq(t.courses.status, 'published'), or(isNull(t.cohortCourses.availableFrom), lte(t.cohortCourses.availableFrom, now))));
            return rows.map((row) => row.id);
        },
        async upsertRelease(release) {
            await upsert(t.cohortCourses, release, [t.cohortCourses.cohortId, t.cohortCourses.courseId], { availableFrom: release.availableFrom, position: release.position });
        },
        async deleteRelease(cohortId, courseId) {
            await db
                .delete(t.cohortCourses)
                .where(and(eq(t.cohortCourses.cohortId, cohortId), eq(t.cohortCourses.courseId, courseId)));
        },
        /* ---------------------------------------------------------- learning */
        async shelfFor(userId) {
            const rows = await db
                .select({
                id: t.courses.id,
                slug: t.courses.slug,
                title: t.courses.title,
                subtitle: t.courses.subtitle,
                summary: t.courses.summary,
                coverImageUrl: t.courses.coverImageUrl,
                cohortName: t.cohorts.name,
                availableFrom: t.cohortCourses.availableFrom,
                position: t.cohortCourses.position,
            })
                .from(t.cohortMembers)
                .innerJoin(t.cohortCourses, eq(t.cohortCourses.cohortId, t.cohortMembers.cohortId))
                .innerJoin(t.cohorts, eq(t.cohorts.id, t.cohortMembers.cohortId))
                .innerJoin(t.courses, eq(t.courses.id, t.cohortCourses.courseId))
                .where(and(eq(t.cohortMembers.userId, userId), eq(t.courses.status, 'published')))
                .orderBy(asc(t.cohortCourses.position), asc(t.courses.title), asc(t.courses.id));
            return rows.map((row) => ({
                id: row.id,
                slug: row.slug,
                title: row.title,
                subtitle: row.subtitle ?? null,
                summary: row.summary ?? null,
                coverImageUrl: row.coverImageUrl ?? null,
                cohortName: row.cohortName ?? null,
                availableFrom: asDate(row.availableFrom),
                position: asNumber(row.position),
            }));
        },
        async progressCounts(userId, courseIds) {
            const out = new Map();
            if (courseIds.length === 0)
                return out;
            /*
             * Counts published lessons only. Counting drafts would show a learner
             * at 60% of a course whose remaining lessons they cannot open, and the
             * percentage would fall when an author published another — which reads
             * as losing progress they had earned.
             */
            const rows = await db
                .select({
                courseId: t.modules.courseId,
                lessonCount: count(),
                completedCount: sql `sum(case when ${t.lessonProgress.completedAt} is null then 0 else 1 end)`,
            })
                .from(t.lessons)
                .innerJoin(t.modules, eq(t.modules.id, t.lessons.moduleId))
                .leftJoin(t.lessonProgress, and(eq(t.lessonProgress.lessonId, t.lessons.id), eq(t.lessonProgress.userId, userId), eq(t.lessonProgress.status, 'completed')))
                .where(and(inArray(t.modules.courseId, courseIds), eq(t.lessons.isPublished, true)))
                .groupBy(t.modules.courseId);
            for (const row of rows) {
                out.set(row.courseId, {
                    lessonCount: asNumber(row.lessonCount),
                    completedCount: asNumber(row.completedCount),
                });
            }
            for (const id of courseIds) {
                if (!out.has(id))
                    out.set(id, { lessonCount: 0, completedCount: 0 });
            }
            return out;
        },
        async outlineFor(courseId, userId) {
            const rows = await db
                .select({
                moduleId: t.modules.id,
                moduleTitle: t.modules.title,
                moduleSummary: t.modules.summary,
                modulePosition: t.modules.position,
                lessonId: t.lessons.id,
                lessonSlug: t.lessons.slug,
                lessonTitle: t.lessons.title,
                lessonSummary: t.lessons.summary,
                lessonKind: t.lessons.kind,
                lessonMinutes: t.lessons.estimatedMinutes,
                lessonPosition: t.lessons.position,
                isPublished: t.lessons.isPublished,
                quizId: t.quizzes.id,
                completedAt: t.lessonProgress.completedAt,
            })
                .from(t.modules)
                .leftJoin(t.lessons, eq(t.lessons.moduleId, t.modules.id))
                .leftJoin(t.quizzes, eq(t.quizzes.lessonId, t.lessons.id))
                .leftJoin(t.lessonProgress, and(eq(t.lessonProgress.lessonId, t.lessons.id), eq(t.lessonProgress.userId, userId)))
                .where(eq(t.modules.courseId, courseId))
                .orderBy(asc(t.modules.position), asc(t.modules.id), asc(t.lessons.position), asc(t.lessons.id));
            return rows.map((row) => ({
                moduleId: row.moduleId,
                moduleTitle: row.moduleTitle,
                moduleSummary: row.moduleSummary ?? null,
                modulePosition: asNumber(row.modulePosition),
                lessonId: row.lessonId ?? null,
                lessonSlug: row.lessonSlug ?? null,
                lessonTitle: row.lessonTitle ?? null,
                lessonSummary: row.lessonSummary ?? null,
                lessonKind: row.lessonKind ?? null,
                lessonMinutes: row.lessonMinutes === null ? null : asNumber(row.lessonMinutes),
                lessonPosition: row.lessonPosition === null ? null : asNumber(row.lessonPosition),
                isPublished: row.isPublished === null ? null : asBool(row.isPublished),
                hasQuiz: Boolean(row.quizId),
                completedAt: asDate(row.completedAt),
            }));
        },
        async findLessonById(id) {
            const [row] = await db
                .select({
                lesson: t.lessons,
                moduleTitle: t.modules.title,
                courseId: t.courses.id,
                courseSlug: t.courses.slug,
                courseTitle: t.courses.title,
            })
                .from(t.lessons)
                .innerJoin(t.modules, eq(t.modules.id, t.lessons.moduleId))
                .innerJoin(t.courses, eq(t.courses.id, t.modules.courseId))
                .where(eq(t.lessons.id, id))
                .limit(1);
            if (!row)
                return null;
            return {
                lesson: lessonOut(row.lesson),
                moduleTitle: row.moduleTitle,
                courseId: row.courseId,
                courseSlug: row.courseSlug,
                courseTitle: row.courseTitle,
            };
        },
        async findLessonBySlug(courseSlug, lessonSlug) {
            const [row] = await db
                .select({
                lesson: t.lessons,
                moduleTitle: t.modules.title,
                courseId: t.courses.id,
                courseSlug: t.courses.slug,
                courseTitle: t.courses.title,
            })
                .from(t.lessons)
                .innerJoin(t.modules, eq(t.modules.id, t.lessons.moduleId))
                .innerJoin(t.courses, eq(t.courses.id, t.modules.courseId))
                .where(and(eq(t.courses.slug, courseSlug), eq(t.lessons.slug, lessonSlug)))
                .limit(1);
            if (!row)
                return null;
            return {
                lesson: lessonOut(row.lesson),
                moduleTitle: row.moduleTitle,
                courseId: row.courseId,
                courseSlug: row.courseSlug,
                courseTitle: row.courseTitle,
            };
        },
        async lessonSequence(courseId) {
            const rows = await db
                .select({ id: t.lessons.id, slug: t.lessons.slug, isPublished: t.lessons.isPublished })
                .from(t.lessons)
                .innerJoin(t.modules, eq(t.modules.id, t.lessons.moduleId))
                .where(eq(t.modules.courseId, courseId))
                // The same order the outline uses. Without the id tiebreak, two
                // lessons sharing a position order differently between queries and
                // "next" sends a learner back where they came from.
                .orderBy(asc(t.modules.position), asc(t.modules.id), asc(t.lessons.position), asc(t.lessons.id));
            return rows.map((row) => ({
                id: row.id,
                slug: row.slug,
                isPublished: asBool(row.isPublished),
            }));
        },
        async attachmentsFor(lessonId) {
            const rows = await db
                .select()
                .from(t.lessonAttachments)
                .where(eq(t.lessonAttachments.lessonId, lessonId))
                .orderBy(asc(t.lessonAttachments.label), asc(t.lessonAttachments.id));
            return rows.map((row) => ({
                id: row.id,
                label: row.label,
                objectKey: row.objectKey,
                contentType: row.contentType ?? null,
                sizeBytes: row.sizeBytes === null ? null : asNumber(row.sizeBytes),
            }));
        },
        /* ----------------------------------------------------------- modules */
        moduleExists(id) {
            return exists(t.modules, eq(t.modules.id, id));
        },
        async nextModulePosition(courseId) {
            /*
             * `max + 1`, not `count`. A deleted row leaves a gap: with three
             * modules at 0, 1, 2 and the middle one deleted, a count hands out 2
             * again and the two rows then order arbitrarily against each other.
             */
            const [row] = await db
                .select({ next: sql `coalesce(max(${t.modules.position}), -1) + 1` })
                .from(t.modules)
                .where(eq(t.modules.courseId, courseId));
            return asNumber(row?.next);
        },
        async insertModule(module) {
            await db.insert(t.modules).values(module);
        },
        async updateModule(id, patch) {
            const result = await db.update(t.modules).set(patch).where(eq(t.modules.id, id));
            return touched(result, t.modules, eq(t.modules.id, id));
        },
        async deleteModule(id) {
            await db.delete(t.modules).where(eq(t.modules.id, id));
        },
        /* ----------------------------------------------------------- lessons */
        lessonSlugExistsInModule(moduleId, slug) {
            return exists(t.lessons, and(eq(t.lessons.moduleId, moduleId), eq(t.lessons.slug, slug)));
        },
        async nextLessonPosition(moduleId) {
            const [row] = await db
                .select({ next: sql `coalesce(max(${t.lessons.position}), -1) + 1` })
                .from(t.lessons)
                .where(eq(t.lessons.moduleId, moduleId));
            return asNumber(row?.next);
        },
        async insertLesson(lesson) {
            await db.insert(t.lessons).values({ ...lesson, isPublished: false });
        },
        async updateLesson(id, patch) {
            const result = await db.update(t.lessons).set(patch).where(eq(t.lessons.id, id));
            return touched(result, t.lessons, eq(t.lessons.id, id));
        },
        async deleteLesson(id) {
            await db.delete(t.lessons).where(eq(t.lessons.id, id));
        },
        async updateVideoByRef(videoRef, state) {
            const before = await db
                .select({ id: t.lessons.id })
                .from(t.lessons)
                .where(eq(t.lessons.videoRef, videoRef));
            if (before.length === 0)
                return 0;
            await db
                .update(t.lessons)
                .set({
                videoStatus: state.status,
                videoDurationSeconds: state.durationSeconds,
                videoThumbnailUrl: state.thumbnailUrl,
                updatedAt: state.updatedAt,
            })
                .where(eq(t.lessons.videoRef, videoRef));
            return before.length;
        },
        /* ------------------------------------------------------- attachments */
        async insertAttachment(attachment) {
            await db.insert(t.lessonAttachments).values(attachment);
        },
        async findAttachment(id) {
            const [row] = await db
                .select({ id: t.lessonAttachments.id, objectKey: t.lessonAttachments.objectKey })
                .from(t.lessonAttachments)
                .where(eq(t.lessonAttachments.id, id))
                .limit(1);
            return row ?? null;
        },
        async deleteAttachment(id) {
            await db.delete(t.lessonAttachments).where(eq(t.lessonAttachments.id, id));
        },
        /* ---------------------------------------------------------- progress */
        async findProgress(userId, lessonId) {
            const [row] = await db
                .select()
                .from(t.lessonProgress)
                .where(and(eq(t.lessonProgress.userId, userId), eq(t.lessonProgress.lessonId, lessonId)))
                .limit(1);
            if (!row)
                return null;
            return {
                status: row.status,
                secondsWatched: asNumber(row.secondsWatched),
                lastPositionSeconds: asNumber(row.lastPositionSeconds),
                completedAt: asDate(row.completedAt),
            };
        },
        async recordWatched({ userId, lessonId, secondsWatched, lastPositionSeconds, at }) {
            /*
             * `secondsWatched` only ever rises. A player posts these every few
             * seconds and they arrive out of order over a flaky connection; a late
             * packet carrying an earlier figure must not rewind what somebody has
             * watched. The resume point is different and is simply set — scrubbing
             * back to re-watch something is deliberate.
             *
             * Neither branch touches `status` or `completedAt`: watching part of a
             * finished lesson again must not un-finish it.
             */
            await upsert(t.lessonProgress, { userId, lessonId, status: 'in_progress', secondsWatched, lastPositionSeconds, updatedAt: at }, [t.lessonProgress.userId, t.lessonProgress.lessonId], {
                secondsWatched: dialect.greatest(t.lessonProgress.secondsWatched, secondsWatched),
                lastPositionSeconds,
                updatedAt: at,
            });
        },
        async markCompleted(userId, lessonId, at) {
            // `coalesce` keeps the first completion date: a learner who re-opens a
            // finished lesson keeps the date they first finished it, which is the
            // date a certificate or a report means.
            await upsert(t.lessonProgress, { userId, lessonId, status: 'completed', completedAt: at, updatedAt: at }, [t.lessonProgress.userId, t.lessonProgress.lessonId], {
                status: 'completed',
                completedAt: sql `coalesce(${t.lessonProgress.completedAt}, ${at})`,
                updatedAt: at,
            });
        },
        async clearCompletion(userId, lessonId, at) {
            await db
                .update(t.lessonProgress)
                .set({ status: 'in_progress', completedAt: null, updatedAt: at })
                .where(and(eq(t.lessonProgress.userId, userId), eq(t.lessonProgress.lessonId, lessonId)));
        },
        /* -------------------------------------------------------- assessment */
        async findQuizById(id) {
            const [row] = await db
                .select({
                quiz: t.quizzes,
                courseId: t.courses.id,
                lessonPublished: t.lessons.isPublished,
            })
                .from(t.quizzes)
                .innerJoin(t.lessons, eq(t.lessons.id, t.quizzes.lessonId))
                .innerJoin(t.modules, eq(t.modules.id, t.lessons.moduleId))
                .innerJoin(t.courses, eq(t.courses.id, t.modules.courseId))
                .where(eq(t.quizzes.id, id))
                .limit(1);
            if (!row)
                return null;
            return {
                id: row.quiz.id,
                lessonId: row.quiz.lessonId,
                title: row.quiz.title,
                instructions: row.quiz.instructions ?? null,
                passingScore: asNumber(row.quiz.passingScore),
                maxAttempts: asNumber(row.quiz.maxAttempts),
                courseId: row.courseId,
                lessonPublished: asBool(row.lessonPublished),
            };
        },
        async findQuizByLesson(lessonId) {
            const [row] = await db.select().from(t.quizzes).where(eq(t.quizzes.lessonId, lessonId)).limit(1);
            if (!row)
                return null;
            return {
                id: row.id,
                lessonId: row.lessonId,
                title: row.title,
                instructions: row.instructions ?? null,
                passingScore: asNumber(row.passingScore),
                maxAttempts: asNumber(row.maxAttempts),
            };
        },
        async paperFor(quizId) {
            /*
             * The select names its columns, and `isCorrect` is not among them.
             * `select()` with no argument would return the whole options row and
             * the answers would reach the browser the moment an endpoint returned
             * the object as JSON — which is how this leaks in practice: not by
             * anybody deciding to send the answers, but by nobody deciding not to.
             */
            const rows = await db
                .select({
                questionId: t.quizQuestions.id,
                prompt: t.quizQuestions.prompt,
                optionId: t.quizOptions.id,
                label: t.quizOptions.label,
            })
                .from(t.quizQuestions)
                .leftJoin(t.quizOptions, eq(t.quizOptions.questionId, t.quizQuestions.id))
                .where(eq(t.quizQuestions.quizId, quizId))
                .orderBy(asc(t.quizQuestions.position), asc(t.quizQuestions.id), asc(t.quizOptions.position), asc(t.quizOptions.id));
            const questions = new Map();
            for (const row of rows) {
                if (!questions.has(row.questionId)) {
                    questions.set(row.questionId, { id: row.questionId, prompt: row.prompt, options: [] });
                }
                if (row.optionId)
                    questions.get(row.questionId).options.push({ id: row.optionId, label: row.label });
            }
            return [...questions.values()];
        },
        async scoringQuestions(quizId) {
            const rows = await db
                .select({
                id: t.quizQuestions.id,
                prompt: t.quizQuestions.prompt,
                explanation: t.quizQuestions.explanation,
            })
                .from(t.quizQuestions)
                .where(eq(t.quizQuestions.quizId, quizId))
                .orderBy(asc(t.quizQuestions.position), asc(t.quizQuestions.id));
            return rows.map((row) => ({ id: row.id, prompt: row.prompt, explanation: row.explanation ?? null }));
        },
        async scoringOptions(quizId) {
            const rows = await db
                .select({
                id: t.quizOptions.id,
                questionId: t.quizOptions.questionId,
                isCorrect: t.quizOptions.isCorrect,
            })
                .from(t.quizOptions)
                .innerJoin(t.quizQuestions, eq(t.quizQuestions.id, t.quizOptions.questionId))
                .where(eq(t.quizQuestions.quizId, quizId));
            return rows.map((row) => ({
                id: row.id,
                questionId: row.questionId,
                isCorrect: asBool(row.isCorrect),
            }));
        },
        async attemptsFor(quizId, userId) {
            const rows = await db
                .select({
                id: t.quizAttempts.id,
                score: t.quizAttempts.score,
                passed: t.quizAttempts.passed,
                submittedAt: t.quizAttempts.submittedAt,
            })
                .from(t.quizAttempts)
                .where(and(eq(t.quizAttempts.quizId, quizId), eq(t.quizAttempts.userId, userId)))
                .orderBy(asc(t.quizAttempts.submittedAt), asc(t.quizAttempts.id));
            return rows.map((row) => ({
                id: row.id,
                score: asNumber(row.score),
                passed: asBool(row.passed),
                submittedAt: asDate(row.submittedAt),
            }));
        },
        async countAttempts(quizId, userId) {
            const [row] = await db
                .select({ count: count() })
                .from(t.quizAttempts)
                .where(and(eq(t.quizAttempts.quizId, quizId), eq(t.quizAttempts.userId, userId)));
            return asNumber(row?.count);
        },
        async insertAttempt(attempt) {
            await db.insert(t.quizAttempts).values(attempt);
        },
        async replaceQuiz(draft, at) {
            /*
             * Replaces the questions wholesale, in a transaction.
             *
             * Editing in place would need to match submitted questions to stored
             * ones, and there is nothing stable to match on while an author is
             * reordering and rewriting them. Past attempts keep their own copy of
             * what was chosen, so they survive — but their option ids no longer
             * resolve, which is why the review tolerates a missing option.
             */
            await db.transaction(async (tx) => {
                const existing = await tx
                    .select({ id: t.quizzes.id })
                    .from(t.quizzes)
                    .where(eq(t.quizzes.lessonId, draft.lessonId))
                    .limit(1);
                const quizId = existing[0]?.id ?? draft.id;
                const header = {
                    title: draft.title,
                    instructions: draft.instructions,
                    passingScore: draft.passingScore,
                    maxAttempts: draft.maxAttempts,
                    updatedAt: at,
                };
                if (existing[0]) {
                    await tx.update(t.quizzes).set(header).where(eq(t.quizzes.id, quizId));
                }
                else {
                    await tx.insert(t.quizzes).values({ id: quizId, lessonId: draft.lessonId, ...header });
                }
                await tx.delete(t.quizQuestions).where(eq(t.quizQuestions.quizId, quizId));
                let position = 0;
                for (const question of draft.questions) {
                    await tx.insert(t.quizQuestions).values({
                        id: question.id,
                        quizId,
                        prompt: question.prompt,
                        explanation: question.explanation,
                        position,
                    });
                    await tx.insert(t.quizOptions).values(question.options.map((option) => ({
                        id: option.id,
                        questionId: question.id,
                        label: option.label,
                        isCorrect: option.isCorrect,
                        position: option.position,
                    })));
                    position += 1;
                }
            });
        },
        async deleteQuiz(id) {
            await db.delete(t.quizzes).where(eq(t.quizzes.id, id));
        },
        async editableQuiz(lessonId) {
            const [quiz] = await db.select().from(t.quizzes).where(eq(t.quizzes.lessonId, lessonId)).limit(1);
            if (!quiz)
                return null;
            const rows = await db
                .select({
                questionId: t.quizQuestions.id,
                prompt: t.quizQuestions.prompt,
                explanation: t.quizQuestions.explanation,
                optionId: t.quizOptions.id,
                label: t.quizOptions.label,
                isCorrect: t.quizOptions.isCorrect,
            })
                .from(t.quizQuestions)
                .leftJoin(t.quizOptions, eq(t.quizOptions.questionId, t.quizQuestions.id))
                .where(eq(t.quizQuestions.quizId, quiz.id))
                .orderBy(asc(t.quizQuestions.position), asc(t.quizQuestions.id), asc(t.quizOptions.position), asc(t.quizOptions.id));
            const questions = new Map();
            for (const row of rows) {
                if (!questions.has(row.questionId)) {
                    questions.set(row.questionId, {
                        id: row.questionId,
                        prompt: row.prompt,
                        explanation: row.explanation ?? null,
                        options: [],
                    });
                }
                if (row.optionId) {
                    questions.get(row.questionId).options.push({
                        id: row.optionId,
                        label: row.label,
                        isCorrect: asBool(row.isCorrect),
                    });
                }
            }
            return {
                id: quiz.id,
                lessonId: quiz.lessonId,
                title: quiz.title,
                instructions: quiz.instructions ?? null,
                passingScore: asNumber(quiz.passingScore),
                maxAttempts: asNumber(quiz.maxAttempts),
                questions: [...questions.values()],
            };
        },
        /* --------------------------------------------------------- catalogue */
        async browseCourses(query) {
            const conditions = [eq(t.courses.status, 'published')];
            if (query.query) {
                const pattern = likePattern(query.query);
                conditions.push(or(dialect.caseInsensitiveLike(t.courses.title, pattern), dialect.caseInsensitiveLike(t.courses.subtitle, pattern), dialect.caseInsensitiveLike(t.courses.summary, pattern)));
            }
            if (query.level)
                conditions.push(eq(t.courses.level, query.level));
            if (query.language)
                conditions.push(eq(t.courses.language, query.language));
            // An exact element match, not a substring: filtering by "Prayer" must
            // not also return courses tagged "Prayerlessness".
            if (query.topic)
                conditions.push(dialect.jsonArrayContains(t.courses.topics, query.topic));
            const where = and(...conditions);
            const [counted] = await db.select({ total: count() }).from(t.courses).where(where);
            const rows = await db
                .select({
                id: t.courses.id,
                slug: t.courses.slug,
                title: t.courses.title,
                subtitle: t.courses.subtitle,
                summary: t.courses.summary,
                coverImageUrl: t.courses.coverImageUrl,
                level: t.courses.level,
                language: t.courses.language,
                topics: t.courses.topics,
                outcomes: t.courses.outcomes,
                estimatedMinutes: t.courses.estimatedMinutes,
            })
                .from(t.courses)
                .where(where)
                // Title then id. Two courses may share a title across two languages,
                // and a tie the database orders differently between two queries drops
                // one across a page boundary while another appears twice.
                .orderBy(asc(t.courses.title), asc(t.courses.id))
                .limit(query.limit)
                .offset(query.offset);
            return {
                total: asNumber(counted?.total),
                rows: rows.map((row) => ({
                    id: row.id,
                    slug: row.slug,
                    title: row.title,
                    subtitle: row.subtitle ?? null,
                    summary: row.summary ?? null,
                    coverImageUrl: row.coverImageUrl ?? null,
                    level: row.level,
                    language: row.language,
                    topics: asList(row.topics),
                    outcomes: asList(row.outcomes),
                    estimatedMinutes: row.estimatedMinutes === null ? null : asNumber(row.estimatedMinutes),
                })),
            };
        },
        async facets() {
            const published = eq(t.courses.status, 'published');
            const [levels, languages, topicResult] = await Promise.all([
                db
                    .select({ value: t.courses.level, count: count() })
                    .from(t.courses)
                    .where(published)
                    .groupBy(t.courses.level)
                    .orderBy(asc(t.courses.level)),
                db
                    .select({ value: t.courses.language, count: count() })
                    .from(t.courses)
                    .where(published)
                    .groupBy(t.courses.language)
                    .orderBy(asc(t.courses.language)),
                // Unnested in the database rather than counted in memory: a filter
                // control has to reflect every published course rather than the page
                // somebody happens to be looking at.
                db.execute(dialect.countJsonElements(t.courses, t.courses.topics, published)),
            ]);
            return {
                levels: levels.map((row) => ({ value: String(row.value), count: asNumber(row.count) })),
                languages: languages.map((row) => ({ value: String(row.value), count: asNumber(row.count) })),
                topics: resultRows(topicResult).map((row) => ({
                    value: String(row.value),
                    count: asNumber(row.count),
                })),
            };
        },
    };
}
