import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { buffer } from "stream/consumers";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};


export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  const formData = await req.formData()
  const image = formData.get("thumbnail")
  if (!(image instanceof File)) {
    throw new BadRequestError("Invalild File")
  }

  const MAX_UPLOAD_SIZE = 10 << 20;
  if (image.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File too large")
  }

  const type = image.type
  const data = await image.arrayBuffer();

  const video = getVideo(cfg.db, videoId);
  if (video?.userID != userID) {
    throw new UserForbiddenError("You do not have permission");
  }


  const baseData = Buffer.from(data).toString("base64")

  const dataUrl = `data:${type};base64,${baseData}`


  video.thumbnailURL = dataUrl
  updateVideo(cfg.db, video);


  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here

  return respondWithJSON(200, video);
}
