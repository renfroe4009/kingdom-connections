/**
 * Every database operation the module performs, in domain terms.
 *
 * This interface exists so the services — where all the rules live — are
 * written once and do not know which database is underneath. One
 * implementation satisfies it for both PostgreSQL and MySQL
 * (`stores/drizzle.ts`), with the handful of genuine dialect differences
 * isolated in `stores/dialect.ts`.
 *
 * Two copies of the services, one per dialect, was the obvious alternative
 * and is rejected: the rules here are the product, and two copies of a rule
 * is one rule that is about to be wrong on one engine. What keeps the two
 * stores honest is that the whole probe suite runs against both.
 *
 * It is also the seam for a host that does not use Drizzle. Implement this —
 * forty-odd methods, none of them clever — against Prisma, Kysely or raw SQL
 * and every rule in the module comes with it, unchanged.
 *
 * **Nothing in here enforces access.** A store method does what it says and
 * no more; it is the services that decide who may call it. A store that
 * filtered by viewer would be a second place where entitlement is decided,
 * which is the one thing this module is built to avoid.
 */
export {};
