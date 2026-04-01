/**
 * Content Ingest Service
 * Downloads remote videos and thumbnails to R2 storage
 */

/**
 * Download a thumbnail from external URL and store in R2
 * Returns the R2 path
 */
export async function ingestThumbnail(
  storage: R2Bucket,
  externalUrl: string,
  slug: string
): Promise<string> {
  const response = await fetch(externalUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch thumbnail: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const r2Path = `thumbnails/${slug}.${ext}`;

  const buffer = await response.arrayBuffer();
  await storage.put(r2Path, buffer, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000",
    },
  });

  return r2Path;
}

/**
 * Download a remote MP4 file and store in R2
 * Returns the R2 path
 */
export async function ingestMP4(
  storage: R2Bucket,
  externalUrl: string,
  slug: string
): Promise<{ path: string; size: number }> {
  const response = await fetch(externalUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch video: ${response.status}`);
  }

  const r2Path = `videos/${slug}/video.mp4`;
  const body = response.body;
  if (!body) throw new Error("Empty response body");

  // Stream directly to R2 using multipart upload for large files
  const contentLength = parseInt(response.headers.get("content-length") || "0");

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

    await upload.complete(parts);
    return { path: r2Path, size: totalSize };
  } else {
    // Small file: direct put
    const buffer = await response.arrayBuffer();
    await storage.put(r2Path, buffer, {
      httpMetadata: {
        contentType: "video/mp4",
        cacheControl: "public, max-age=31536000",
      },
    });
    return { path: r2Path, size: buffer.byteLength };
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
  const masterRes = await fetch(manifestUrl);
  if (!masterRes.ok) {
    throw new Error(`Failed to fetch manifest: ${masterRes.status}`);
  }
  let masterContent = await masterRes.text();

  // Check if it's a master playlist (contains variant streams) or a media playlist
  const isMaster = masterContent.includes("#EXT-X-STREAM-INF");

  if (isMaster) {
    // Parse variant playlists
    const lines = masterContent.split("\n");
    const variantUrls: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        // This is a variant playlist URI
        const fullUrl = trimmed.startsWith("http") ? trimmed : `${baseUrl}${trimmed}`;
        variantUrls.push(fullUrl);
      }
    }

    // Download each variant playlist and its segments
    for (let i = 0; i < variantUrls.length; i++) {
      const variantUrl = variantUrls[i];
      const variantBase = variantUrl.substring(0, variantUrl.lastIndexOf("/") + 1);
      const variantFilename = variantUrl.substring(variantUrl.lastIndexOf("/") + 1);
      const variantDir = `variant_${i}`;

      try {
        const varRes = await fetch(variantUrl);
        if (!varRes.ok) {
          errors.push(`Failed to fetch variant ${i}: ${varRes.status}`);
          continue;
        }
        let varContent = await varRes.text();

        // Download segments referenced in this variant
        const varLines = varContent.split("\n");
        const newVarLines: string[] = [];

        for (const vLine of varLines) {
          const vTrimmed = vLine.trim();
          if (vTrimmed && !vTrimmed.startsWith("#") && (vTrimmed.endsWith(".ts") || vTrimmed.endsWith(".m4s") || vTrimmed.endsWith(".aac") || vTrimmed.includes(".ts?"))) {
            // This is a segment
            const segUrl = vTrimmed.startsWith("http") ? vTrimmed : `${variantBase}${vTrimmed}`;
            const segFilename = `seg_${segmentCount}.ts`;

            try {
              const segRes = await fetch(segUrl);
              if (segRes.ok) {
                const segData = await segRes.arrayBuffer();
                await storage.put(`videos/${slug}/${variantDir}/${segFilename}`, segData, {
                  httpMetadata: {
                    contentType: "video/mp2t",
                    cacheControl: "public, max-age=31536000",
                  },
                });
                newVarLines.push(segFilename);
                segmentCount++;
              } else {
                errors.push(`Segment fetch failed: ${segUrl} (${segRes.status})`);
                newVarLines.push(vTrimmed); // keep original
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

    // Rewrite master playlist to point to local variant paths
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
    // Single media playlist — download segments directly
    const lines = masterContent.split("\n");
    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && (trimmed.endsWith(".ts") || trimmed.endsWith(".m4s") || trimmed.includes(".ts?"))) {
        const segUrl = trimmed.startsWith("http") ? trimmed : `${baseUrl}${trimmed}`;
        const segFilename = `seg_${segmentCount}.ts`;

        try {
          const segRes = await fetch(segUrl);
          if (segRes.ok) {
            const segData = await segRes.arrayBuffer();
            await storage.put(`videos/${slug}/segments/${segFilename}`, segData, {
              httpMetadata: {
                contentType: "video/mp2t",
                cacheControl: "public, max-age=31536000",
              },
            });
            newLines.push(`segments/${segFilename}`);
            segmentCount++;
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
