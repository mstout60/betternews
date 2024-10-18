import { Post, SuccessResponse } from "@/shared/types";
import { InfiniteData, useMutation, useQueryClient } from "@tanstack/react-query";
import { GetPostSuccess, upvotePost } from "./api";
import { current, produce } from "immer";
import { toast } from "sonner";

const updatePostUpvote = (draft: Post) => {
    draft.points += draft.isUpvoted ? -1 : +1;
    draft.isUpvoted = !draft.isUpvoted;
};

export const useUpvotePost = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: upvotePost,
        onMutate: async (varable) => {
            let prevData;
            await queryClient.cancelQueries({ queryKey: ["post", Number(varable)] });

            queryClient.setQueryData<SuccessResponse<Post>>(
                ["post", Number(varable)],
                produce(draft => {
                    if (!draft) {
                        return undefined;
                    }
                    updatePostUpvote(draft.data);
                }),
            );

            queryClient.setQueriesData<InfiniteData<GetPostSuccess>>(
                {
                    queryKey: ["posts"],
                    type: "active"
                },
                produce(oldData => {
                    prevData = current(oldData);
                    if (!oldData) {
                        return undefined;
                    }
                    oldData.pages.forEach((page) => {
                        page.data.forEach((post) => {
                            if (post.id.toString() === varable) {
                                updatePostUpvote(post);
                            }
                        })
                    })
                }),
            );
            return { prevData };
        },
        onSuccess: (upvoteData, variable) => {
            queryClient.setQueryData<SuccessResponse<Post>>(
                ["posts", Number(variable)],
                produce((draft) => {
                    if (!draft) {
                        return undefined;
                    }
                    draft.data.points = upvoteData.data.count;
                    draft.data.isUpvoted = upvoteData.data.isUpvoted;
                }),
            );

            queryClient.setQueriesData<InfiniteData<GetPostSuccess>>({
                queryKey: ["posts"]
            },
                produce(oldData => {
                    if (!oldData) {
                        return undefined;
                    }
                    oldData.pages.forEach((page) =>
                        page.data.forEach((post) => {
                            if (post.id.toString() === variable) {
                                post.points = upvoteData.data.count;
                                post.isUpvoted = upvoteData.data.isUpvoted;
                            }
                        }),
                    );
                }),
            );
            queryClient.invalidateQueries({
                queryKey: ["posts"],
                type: "inactive",
                refetchType: "none"
            });
        },
        onError: (err, variable, context) => {
            console.error(err)
            queryClient.invalidateQueries({ queryKey: ["post", Number(variable)] })
            toast.error("Failed to upvote post")

            if (context?.prevData) {
                queryClient.setQueriesData(
                    {
                        queryKey: ["posts"], type: "active"
                    },
                    context.prevData
                );
                queryClient.invalidateQueries({
                    queryKey: ["posts"],
                })
            }
        },
    });
};