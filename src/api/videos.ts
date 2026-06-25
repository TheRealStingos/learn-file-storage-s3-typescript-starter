import { respondWithJSON } from "./json";
import { getBearerToken, validateJWT } from "../auth";
import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError } from "./errors";
import { getVideo, updateVideo } from "../db/videos";
import { UserForbiddenError } from "./errors";
import { unlink } from "fs/promises"
import { type Video } from "../db/videos";


export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  const formData = await req.formData()
  const videoData = formData.get("video")
  if (!(videoData instanceof File)) {
    throw new BadRequestError("Invalild File")
  }

  const MAX_UPLOAD_SIZE = 1 << 30;
  if (videoData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File too large")
  }

  const video = getVideo(cfg.db, videoId)
  if (!video) {
    throw new BadRequestError("Video not found")
  }
  if (video.userID != userID) {
    throw new UserForbiddenError("You do not have permission");
  }
  if (videoData.type !== "video/mp4") {
    throw new BadRequestError("File must be an MP4")
  }
  const tempPath = `/tmp/${videoId}.mp4`;
  await Bun.write(tempPath, videoData);
  const file = Bun.file(tempPath);
  const aspectRatio = await getVideoAspectRatio(tempPath);
  const processedVideo = await processVideoForFastStart(tempPath)
  const key = `${aspectRatio}/${videoId}.mp4`;
  const s3file = cfg.s3Client.file(key, { bucket: cfg.s3Bucket });
  await s3file.write(Bun.file(processedVideo), { type: "video/mp4" })
  video.videoURL = `${cfg.s3CfDistribution}/${key}`
  updateVideo(cfg.db, video)
  await Promise.all([
    unlink(tempPath),
    unlink(processedVideo)
  ]);

  return respondWithJSON(200, video);
}

export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", `${filePath}`], {
    stdout: "pipe",
    stderr: "pipe"
  });


  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${stderrText}`)
  };

  const parsed = JSON.parse(stdoutText);
  const width = parsed.streams[0].width;
  const height = parsed.streams[0].height;

  if (width === Math.floor(16 * (height / 9))) {
    return "landscape"
  }
  else if (height === Math.floor(16 * (width / 9))) {
    return "portrait"
  }

  else {
    return "other"
  }
}

export async function processVideoForFastStart(inputFilePath: string) {
  const outputPath = `${inputFilePath}.processed`;
  const proc = Bun.spawn(["ffmpeg", "-i", `${inputFilePath}`, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", `${outputPath}`])
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error("Command failed")
  }

  return outputPath;
}