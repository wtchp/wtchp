/**
 * Content Ingest Service
 * Downloads remote videos and thumbnails to R2 storage
 */

const VIDEO_CONTENT_TYPES = ["video/mp4", "video/webm", "video/mpeg", "application/octet-stream", "binary/octet-stream"];
const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MIN_VIDEO_SIZE = 50_000; // 50KB minimum for a valid video
const MIN_IMAGE_SIZE = 500;   // 500 bytes minimum for a valid image

/**
 * Fetch with redirect following and User-Agent header
 * (some CDNs block requests without a proper UA)
 */
async function safeFetch(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": new URL(url).origin + "/",
    },
    redirect: "follow",
  });
  return response;
}

/**
 * Download a thumbnail from external URL and store in R2
 * Returns the R2 path
 */
export async function ingestThumbnail(
  storage: R2Bucket,
  externalUrl: string,
  slug: string
): Promise<string> {
  const response = await safeFetch(externalUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch thumbnail: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";

  // Validate it's actually an image
  if (contentType && !IMAGE_CONTENT_TYPES.some(t => contentType.includes(t)) && !contentType.includes("octet-stream")) {
    throw new Error(`Invalid thumbnail content-type: ${contentType}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < MIN_IMAGE_SIZE) {
    throw new Error(`Thumbnail too small (${buffer.byteLength} bytes) - likely not a real image`);
  }

  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const r2Path = `thumbnails/${slug}.${ext}`;

  await storage.put(r2Path, buffer, {
    httpMetadata: {
      contentType: contentType || "image/jpeg",
      cacheControl: "public, max-age=31536000",
    },
  });

  return r2Path;
}

/**
 * Download a remote MP4 file and store in R2
 * Validates that the response is actually a video
 */
export async function ingestMP4(
  storage: R2Bucket,
  externalUrl: string,
  slug: string
): Promise<{ path: string; size: number }> {
  const response = await safeFetch(externalUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const contentLength = parseInt(response.headers.get("content-length") || "0");

  // Validate content-type — reject HTML / JSON / text responses
  if (contentType.includes("text/html") || contentType.includes("application/json") || contentType.includes("text/plain")) {
    const preview = await response.text();
    throw new Error(`Source returned ${contentType} instead of video. Preview: ${preview.substring(0, 200)}`);
  }

  // Validate size if known
  if (contentLength > 0 && contentLength < MIN_VIDEO_SIZE) {
    const body = await response.text();
    throw new Error(`Response too small (${contentLength} bytes). Content: ${body.substring(0, 200)}`);
  }

  const r2Path = `videos/${slug}/video.mp4`;
  const body = response.body;
  if (!body) throw new Error("Empty response body");

  if (contentLength > 100 * 1024 * 1024) {
    // >100MB: use multipart upload
    const upload = await storage.createMultipartUpload(r2Path, {
      httpMetadata: {
        contentType: "video/mp4",
        cacheControl: "public, max-age=31536000",
      },
    });

    const reader = body.getReader();
    const chunkSize = 10 * 1024 * 1024; // 10MB parts
    let partNumber = 1;
    const parts: R2UploadedPart[] = [];
    let buffer = new Uint8Array(0);
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;
        totalSize += value.length;
      }

      if (buffer.length >= chunkSize || (done && buffer.length > 0)) {
        const chunk = buffer.slice(0, chunkSize);
        buffer = buffer.slice(chunkSize);

        const part = await upload.uploadPart(partNumber, chunk);
        parts.push(part);
        partNumber++;
      }

      if (done) {
        if (buffer.length > 0) {
          const part = await upload.uploadPart(partNumber, buffer);
          parts.push(part);
        }
        break;
      }
    }

    // Validate size after download
    if (totalSize < MIN_VIDEO_SIZE) {
      await upload.abort();
      throw new Error(`Downloaded video too small (${totalSize} bytes) - likely not a valid video`);
    }

    await upload.complete(parts);
    return { path: r2Path, size: totalSize };
  } else {
    // Small file: direct put
    const arrayBuffer = await response.arrayBuffer();

    // Validate size
    if (arrayBuffer.byteLength < MIN_VIDEO_SIZE) {
      throw new Error(`Downloaded video too small (${arrayBuffer.byteLength} bytes). This is likely not a valid video file.`);
    }

    await storage.put(r2Path, arrayBuffer, {
      httpMetadata: {
        contentType: "video/mp4",
        cacheControl: "public, max-age=31536000",
      },
    });
    return { path: r2Path, size: arrayBuffer.byteLength };
  }
}

/**
 * Download a remote HLS stream (m3u8 + segments) and store in R2
 * Rewrites the manifest to point to local R2 paths
 */
export async function ingestHLS(
  storage: R2Bucket,
  manifestUrl: string,
  slug: string
): Promise<{ path: string; segmentCount: number; errors: string[] }> {
  const errors: string[] = [];
  let segmentCount = 0;
  const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);

  // Fetch master manifest
  const masterRes = await safeFetch(manifestUrl);
  if (!masterRes.ok) {
    throw new Error(`Failed to fetch manifest: ${masterRes.status}`);
  }
  let masterContent = await masterRes.text();

  // Validate it looks like an m3u8
  if (!masterContent.includes("#EXTM3U")) {
    throw new Error(`Invalid manifest — does not contain #EXTM3U. Got: ${masterContent.substring(0, 200)}`);
  }

  // Check if it's a master playlist (contains variant streams) or a media playlist
  const isMaster = masterContent.includes("#EXT-X-STREAM-INF");

  if (isMaster) {
    // Parse variant playlists
    const lines = masterContent.split("\n");
    const variantUrls: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const fullUrl = trimmed.startsWith("http") ? trimmed : `${baseUrl}${trimmed}`;
        variantUrls.push(fullUrl);
      }
    }

    // Download each variant playlist and its segments
    for (let i = 0; i < variantUrls.length; i++) {
      const variantUrl = variantUrls[i];
      const variantBase = variantUrl.substring(0, variantUrl.lastIndexOf("/") + 1);
      const variantDir = `variant_${i}`;

      try {
        const varRes = await safeFetch(variantUrl);
        if (!varRes.ok) {
          errors.push(`Failed to fetch variant ${i}: ${varRes.status}`);
          continue;
        }
        const varContent = await varRes.text();

        // Validate variant playlist
        if (!varContent.includes("#EXTM3U")) {
          errors.push(`Variant ${i} is not a valid m3u8`);
          continue;
        }

        // Download segments
        const varLines = varContent.split("\n");
        const newVarLines: string[] = [];

        for (const vLine of varLines) {
          const vTrimmed = vLine.trim();
          if (vTrimmed && !vTrimmed.startsWith("#") && isSegmentLine(vTrimmed)) {
            const segUrl = vTrimmed.startsWith("http") ? vTrimmed : `${variantBase}${vTrimmed}`;
            const segFilename = `seg_${segmentCount}.ts`;

            try {
              const segRes = await safeFetch(segUrl);
              if (segRes.ok) {
                const segData = await segRes.arrayBuffer();
                if (segData.byteLength > 100) { // at least 100 bytes for a valid segment
                  await storage.put(`videos/${slug}/${variantDir}/${segFilename}`, segData, {
                    httpMetadata: {
                      contentType: "video/mp2t",
                      cacheControl: "public, max-age=31536000",
                    },
                  });
                  newVarLines.push(segFilename);
                  segmentCount++;
                } else {
                  errors.push(`Segment too small: ${segUrl} (${segData.byteLength}b)`);
                  newVarLines.push(vTrimmed);
                }
              } else {
                errors.push(`Segment ${segUrl}: ${segRes.status}`);
                newVarLines.push(vTrimmed);
              }
            } catch (e: any) {
              errors.push(`Segment error: ${e.message}`);
              newVarLines.push(vTrimmed);
            }
          } else {
            newVarLines.push(vTrimmed);
          }
        }

        // Save rewritten variant playlist
        const newVarContent = newVarLines.join("\n");
        await storage.put(`videos/${slug}/${variantDir}/playlist.m3u8`, newVarContent, {
          httpMetadata: {
            contentType: "application/vnd.apple.mpegurl",
            cacheControl: "public, max-age=3600",
          },
        });
      } catch (e: any) {
        errors.push(`Variant ${i} error: ${e.message}`);
      }
    }

    // Rewrite master playlist
    const masterLines = masterContent.split("\n");
    const newMasterLines: string[] = [];
    let variantIndex = 0;

    for (const mLine of masterLines) {
      const mTrimmed = mLine.trim();
      if (mTrimmed && !mTrimmed.startsWith("#")) {
        newMasterLines.push(`variant_${variantIndex}/playlist.m3u8`);
        variantIndex++;
      } else {
        newMasterLines.push(mTrimmed);
      }
    }

    masterContent = newMasterLines.join("\n");
  } else {
    // Single media playlist
    const lines = masterContent.split("\n");
    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && isSegmentLine(trimmed)) {
        const segUrl = trimmed.startsWith("http") ? trimmed : `${baseUrl}${trimmed}`;
        const segFilename = `seg_${segmentCount}.ts`;

        try {
          const segRes = await safeFetch(segUrl);
          if (segRes.ok) {
            const segData = await segRes.arrayBuffer();
            if (segData.byteLength > 100) {
              await storage.put(`videos/${slug}/segments/${segFilename}`, segData, {
                httpMetadata: {
                  contentType: "video/mp2t",
                  cacheControl: "public, max-age=31536000",
                },
              });
              newLines.push(`segments/${segFilename}`);
              segmentCount++;
            } else {
              errors.push(`Segment too small: ${segUrl}`);
              newLines.push(trimmed);
            }
          } else {
            errors.push(`Segment failed: ${segUrl}`);
            newLines.push(trimmed);
          }
        } catch (e: any) {
          errors.push(`Segment error: ${e.message}`);
          newLines.push(trimmed);
        }
      } else {
        newLines.push(trimmed);
      }
    }
    masterContent = newLines.join("\n");
  }

  // Validate we actually downloaded something
  if (segmentCount === 0) {
    throw new Error(`No segments were downloaded. ${errors.length} errors occurred: ${errors.slice(0, 3).join("; ")}`);
  }

  // Save master manifest
  const masterPath = `videos/${slug}/master.m3u8`;
  await storage.put(masterPath, masterContent, {
    httpMetadata: {
      contentType: "application/vnd.apple.mpegurl",
      cacheControl: "public, max-age=3600",
    },
  });

  return { path: masterPath, segmentCount, errors };
}

function isSegmentLine(line: string): boolean {
  return (
    line.endsWith(".ts") ||
    line.endsWith(".m4s") ||
    line.endsWith(".aac") ||
    line.endsWith(".mp4") ||
    line.includes(".ts?") ||
    line.includes(".m4s?")
  );
}
