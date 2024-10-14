import { db } from "@/adapter";
import type { Context } from "@/context";
import { userTable } from "@/db/schemas/auth";
import { postsTable } from "@/db/schemas/post";
import { postUpvotesTable } from "@/db/schemas/upvotes";
import { getISOFormatDateQuery } from "@/lib/utils";
import { loggedIn } from "@/middleware/loggedIn";
import { createPostSchema, paginationSchema, type PaginatedResponse, type Post, type SuccessResponse } from "@/shared/types";
import { zValidator } from "@hono/zod-validator";
import { and, asc, countDistinct, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

export const postRouter = new Hono<Context>()
    .post("/", loggedIn, zValidator("form", createPostSchema), async (c) => {
        const { title, url, content } = c.req.valid("form");
        const user = c.get("user")!;
        const [post] = await db
            .insert(postsTable)
            .values({
                title,
                content,
                url,
                userId: user.id,
            }).returning({ id: postsTable.id });
        return c.json<SuccessResponse<{ postId: number }>>({
            success: true,
            message: "Post created",
            data: { postId: post.id }
        }, 201);
    },
    )
    .get("/", zValidator("query", paginationSchema), async (c) => {
        const { limit, page, sortBy, order, author, site } = c.req.valid("query");
        const user = c.get("user");

        //Pagination offset
        const offset = (page - 1) * limit;

        const sortByColumn = sortBy === "points" ? postsTable.points : postsTable.createdAt;
        const sortOrder = order === "desc" ? desc(sortByColumn) : asc(sortByColumn);

        const [count] = await db
            .select({ count: countDistinct(postsTable.id) })
            .from(postsTable)
            .where(
                and(
                    author ? eq(postsTable.userId, author) : undefined,
                    site ? eq(postsTable.url, site) : undefined,
                ),
            );

        const postsQuery = db.select({
            id: postsTable.id,
            title: postsTable.title,
            url: postsTable.url,
            points: postsTable.points,
            createdAt: getISOFormatDateQuery(postsTable.createdAt),
            commentCount: postsTable.commentCount,
            author: {
                username: userTable.username,
                id: userTable.id,
            },
            isUpvoted: user
                ? sql<boolean>`CASE WHEN ${postUpvotesTable.userId} IS NOT NULL THEN true ELSE False END`
                : sql<boolean>`false`,
        }).from(postsTable).leftJoin(userTable, eq(postsTable.userId, userTable.id))
            .orderBy(sortOrder)
            .limit(limit)
            .offset(offset)
            .where(
                and(
                    author ? eq(postsTable.userId, author) : undefined,
                    site ? eq(postsTable.url, site) : undefined,
                ),
            );

        if (user) {
            postsQuery.leftJoin(postUpvotesTable,
                and(
                    eq(postUpvotesTable.postId, postsTable.id),
                    eq(postUpvotesTable.userId, user.id),
                ),
            );
        }

        const posts = await postsQuery;

        return c.json<PaginatedResponse<Post[]>>({
            data: posts as Post[],
            success: true,
            message: "Post fetched",
            pagination: {
                page: page,
                totalPages: Math.ceil(count.count / limit) as number,
            },
        }, 200);
    })
    .post("/:id/upvote", loggedIn, zValidator("param", z.object({ id: z.coerce.number() })), async (c) => {
        const { id } = c.req.valid("param");
        const user = c.get("user")!;

        let pointChange: -1 | 1 = 1;

        const points = await db.transaction(async (tx) => {
            const [existingUpvote] = await tx
                .select()
                .from(postUpvotesTable)
                .where(
                    and(
                        eq(postUpvotesTable.postId, id),
                        eq(postUpvotesTable.userId, user.id),
                    ),
                )
                .limit(1);

            pointChange = existingUpvote ? -1 : 1;

            const [updated] = await tx.update(postsTable)
                .set({
                    points: sql`${postsTable.points} + ${pointChange}`
                })
                .where(
                    eq(postsTable.id, id),
                )
                .returning({ points: postsTable.points });

            if (!updated) {
                throw new HTTPException(404, { message: "Post not found" });
            }

            if (existingUpvote) {
                await tx
                    .delete(postUpvotesTable)
                    .where(
                        eq(postUpvotesTable.id, existingUpvote.id),
                    );
            } else {
                await tx
                    .insert(postUpvotesTable)
                    .values({ postId: id, userId: user.id });
            }

            return updated.points;
        });

        return c.json<SuccessResponse<{ count: number, isUpvoted: boolean }>>({
            success: true,
            message: "Post updated",
            data: { count: points, isUpvoted: pointChange > 0 },
        }, 200);
    });
