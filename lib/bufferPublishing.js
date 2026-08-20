export const BUFFER_API_URL = "https://api.buffer.com";

export const BUFFER_FACEBOOK_CHANNELS = Object.freeze({
  "Van Finance Facebook": "6a8721fbccaf649a67e227a3",
  "Rent2Buy Facebook": "6a8722ffccaf649a67e22bc6",
});

export const BUFFER_CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        post {
          id
          text
          status
          assets {
            id
            mimeType
          }
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

function clean(value) {
  return String(value ?? "").trim();
}

function assertHttpUrl(value, label) {
  const url = clean(value);
  if (!/^https:\/\//i.test(url)) {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }
  return url;
}

export function bufferDestinationForProduct(productKey) {
  if (productKey === "vanFinance") return "Van Finance Facebook";
  if (productKey === "rent2buy") return "Rent2Buy Facebook";
  throw new Error("Unsupported Buffer product key.");
}

export function bufferChannelForDestination(destination) {
  const channelId = BUFFER_FACEBOOK_CHANNELS[destination];
  if (!channelId) throw new Error("Unsupported Facebook destination.");
  return channelId;
}

export function buildBufferCreatePostInput({
  destination,
  text,
  mediaUrl,
  mediaKind = "image",
  draft = true,
} = {}) {
  const channelId = bufferChannelForDestination(destination);
  const cleanText = clean(text);
  if (!cleanText) throw new Error("Facebook caption is required.");

  const url = assertHttpUrl(mediaUrl, mediaKind === "video" ? "Video URL" : "Image URL");
  const isVideo = mediaKind === "video";

  return {
    text: cleanText,
    channelId,
    schedulingType: "automatic",
    mode: "addToQueue",
    saveToDraft: Boolean(draft),
    source: "vfc-marketing-crm",
    assets: [
      isVideo
        ? { video: { url } }
        : { image: { url } },
    ],
    metadata: {
      facebook: {
        type: isVideo ? "reel" : "post",
      },
    },
  };
}

export function parseBufferCreatePostPayload(payload) {
  const graphError = Array.isArray(payload?.errors) ? payload.errors[0]?.message : "";
  if (graphError) throw new Error(graphError);

  const result = payload?.data?.createPost;
  if (result?.message) throw new Error(result.message);
  if (!result?.post?.id) throw new Error("Buffer did not return a post ID.");

  return result.post;
}

// Stuart said: "Fuck you, Meta."
// Buffer publishing route created after Meta's second-admin circus.
