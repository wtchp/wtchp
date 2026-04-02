/**
 * Content Ingest Service
 * Downloads remote videos and thumbnails to R2 storage
 */

const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MIN_VIDEO_SIZE = 50_000; // 50KB minimum for a valid video
const MIN_IMAGE_SIZE = 500;   // 500 bytes minimum for a valid image

/**
 * Fetch with redirect following and User-Agent header
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
  if (contentType && !IMAGE_CONTENT_TYPES.some(t => contentType.includes(t)) && !contentType.includes("octet-stream")) {
    throw new Error(`Invalid thumbnail content-type: ${contentType}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < MIN_IMAGE_SIZE) {
    throw new Error(`Thumbnail too small (${buffer.byteLength} bytes)`);
  }

  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const r2Path = `thumbnails/${slug}.${ext}`;

  await storage.put(r2Path, buffer, {
    httpMetadata: { contentType: contentType || "image/jpeg", cacheControl: "public, max-age=31536000" },
  });

  return r2Path;
}

/**
 * Download a remote MP4 file and store in R2
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

  if (contentType.includes("text/html") || contentType.includes("application/json") || contentType.includes("text/plain")) {
    const preview = await response.text();
    throw new Error(`Source returned ${contentType} instead of video. Preview: ${preview.substring(0, 200)}`);
  }

  if (contentLength > 0 && contentLength < MIN_VIDEO_SIZE) {
    const body = await response.text();
    throw new Error(`Response too small (${contentLength} bytes). Content: ${body.substring(0, 200)}`);
  }

  const r2Path = `videos/${slug}/video.mp4`;
  const body = response.body;
  if (!body) throw new Error("Empty response body");

  if (contentLength > 100 * 1024 * 1024) {
    const upload = await storage.createMultipartUpload(r2Path, {
      httpMetadata: { contentType: "video/mp4", cacheControl: "public, max-age=31536000" },
    });

    const reader = body.getReader();
    const chunkSize = 10 * 1024 * 1024;
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

    if (totalSize < MIN_VIDEO_SIZE) {
      await upload.abort();
      throw new Error(`Downloaded video too small (${totalSize} bytes)`);
    }

    await upload.complete(parts);
    return { path: r2Path, size: totalSize };
  } else {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength < MIN_VIDEO_SIZE) {
      throw new Error(`Downloaded video too small (${arrayBuffer.byteLength} bytes)`);
    }
    await storage.put(r2Path, arrayBuffer, {
      httpMetadata: { contentType: "video/mp4", cacheControl: "public, max-age=31536000" },
    });
    return { path: r2Path, size: arrayBuffer.byteLength };
  }
}

/**
 * Download a remote HLS stream (m3u8 + segments) and store in R2
 */
export async function ingestHLS(
  storage: R2Bucket,
  manifestUrl: string,
  slug: string
): Promise<{ path: string; segmentCount: number; errors: string[] }> {
  const errors: string[] = [];
  let segmentCount = 0;
  const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);

  const masterRes = await safeFetch(manifestUrl);
  if (!masterRes.ok) throw new Error(`Failed to fetch manifest: ${masterRes.status}`);
  let masterContent = await masterRes.text();

  if (!masterContent.includes("#EXTM3U")) {
    throw new Error(`Invalid manifest. Got: ${masterContent.substring(0, 200)}`);
  }

  const isMaster = masterContent.includes("#EXT-X-STREAM-INF");

  if (isMaster) {
    const lines = masterContent.split("\n");
    const variantUrls: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        variantUrls.push(trimmed.startsWith("http") ? trimmed : `${baseUrl}${trimmed}`);
      }
    }

    for (let i = 0; i < variantUrls.length; i++) {
      const variantUrl = variantUrls[i];
      const variantBase = variantUrl.substring(0, variantUrl.lastIndexOf("/") + 1);
      const variantDir = `variant_${i}`;
      try {
        const varRes = await safeFetch(variantUrl);
        if (!varRes.ok) { errors.push(`Variant ${i}: ${varRes.status}`); continue; }
        const varContent = await varRes.text();
        if (!varContent.includes("#EXTM3U")) { errors.push(`Variant ${i}: not m3u8`); continue; }

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
                if (segData.byteLength > 100) {
                  await storage.put(`videos/${slug}/${variantDir}/${segFilename}`, segData, {
                    httpMetadata: { contentType: "video/mp2t", cacheControl: "public, max-age=31536000" },
                  });
                  newVarLines.push(segFilename);
                  segmentCount++;
                } else { newVarLines.push(vTrimmed); }
              } else { newVarLines.push(vTrimmed); }
            } catch { newVarLines.push(vTrimmed); }
          } else { newVarLines.push(vTrimmed); }
        }
        await storage.put(`videos/${slug}/${variantDir}/playlist.m3u8`, newVarLines.join("\n"), {
          httpMetadata: { contentType: "application/vnd.apple.mpegurl" },
        });
      } catch (e: any) { errors.push(`Variant ${i}: ${e.message}`); }
    }

    // Rewrite master
    const masterLines = masterContent.split("\n");
    const newMasterLines: string[] = [];
    let vi = 0;
    for (const mLine of masterLines) {
      const mt = mLine.trim();
      if (mt && !mt.startsWith("#")) { newMasterLines.push(`variant_${vi}/playlist.m3u8`); vi++; }
      else { newMasterLines.push(mt); }
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
                httpMetadata: { contentType: "video/mp2t", cacheControl: "public, max-age=31536000" },
              });
              newLines.push(`segments/${segFilename}`);
              segmentCount++;
            } else { newLines.push(trimmed); }
          } else { newLines.push(trimmed); }
        } catch { newLines.push(trimmed); }
      } else { newLines.push(trimmed); }
    }
    masterContent = newLines.join("\n");
  }

  if (segmentCount === 0) {
    throw new Error(`No segments downloaded. ${errors.slice(0, 3).join("; ")}`);
  }

  const masterPath = `videos/${slug}/master.m3u8`;
  await storage.put(masterPath, masterContent, {
    httpMetadata: { contentType: "application/vnd.apple.mpegurl", cacheControl: "public, max-age=3600" },
  });

  return { path: masterPath, segmentCount, errors };
}

function isSegmentLine(line: string): boolean {
  return line.endsWith(".ts") || line.endsWith(".m4s") || line.endsWith(".aac") ||
         line.endsWith(".mp4") || line.includes(".ts?") || line.includes(".m4s?");
}

/**
 * Download a DASH stream (.mpd) — keep as MPD format
 * Only downloads best quality per AdaptationSet to stay within Worker limits
 */
export async function ingestDASH(
  storage: R2Bucket,
  mpdUrl: string,
  slug: string
): Promise<{ path: string; segmentCount: number; errors: string[] }> {
  const errors: string[] = [];
  let segmentCount = 0;
  const baseUrl = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);

  const mpdRes = await safeFetch(mpdUrl);
  if (!mpdRes.ok) throw new Error(`Failed to fetch MPD: ${mpdRes.status}`);
  const mpdContent = await mpdRes.text();

  if (!mpdContent.includes("<MPD") && !mpdContent.includes("<mpd")) {
    throw new Error(`Invalid MPD. Content: ${mpdContent.substring(0, 200)}`);
  }

  const durMatch = mpdContent.match(/mediaPresentationDuration="([^"]+)"/);
  const totalDuration = durMatch ? parseDuration(durMatch[1]) : 0;

  const adaptSets = splitAdaptationSets(mpdContent);
  const filesToDownload: string[] = [];
  const selectedRepIds = new Set<string>();

  for (const adaptSet of adaptSets) {
    const initTpl = extractAttr(adaptSet, "initialization");
    const mediaTpl = extractAttr(adaptSet, "media");
    const startNum = parseInt(extractAttr(adaptSet, "startNumber") || "1");
    const timescale = parseInt(extractAttr(adaptSet, "timescale") || "1000");

    if (!mediaTpl) continue;

    // Get all reps with bandwidth — pick ONLY the best one
    const reps: { id: string; bandwidth: number }[] = [];
    for (const m of adaptSet.matchAll(/<Representation[^>]+>/gi)) {
      const id = extractAttr(m[0], "id");
      const bw = parseInt(extractAttr(m[0], "bandwidth") || "0");
      if (id) reps.push({ id, bandwidth: bw });
    }
    if (reps.length === 0) continue;

    reps.sort((a, b) => b.bandwidth - a.bandwidth);
    const bestRep = reps[0];
    selectedRepIds.add(bestRep.id);

    // Count segments
    let numSegments = 0;
    const sMatches = [...adaptSet.matchAll(/<S\s+([^/>]+)\/?\s*>/gi)];
    if (sMatches.length > 0) {
      for (const sm of sMatches) {
        const r = parseInt(sm[1].match(/r="(\d+)"/)?.[1] || "0");
        numSegments += 1 + r;
      }
    } else {
      const segDur = parseInt(extractAttr(adaptSet, "duration") || "0");
      numSegments = (segDur > 0 && totalDuration > 0)
        ? Math.ceil(totalDuration / (segDur / timescale))
        : (totalDuration > 0 ? Math.ceil(totalDuration / 6) : 200);
    }

    if (initTpl) filesToDownload.push(resolveTemplate(initTpl, bestRep.id, 0));
    for (let n = startNum; n < startNum + numSegments; n++) {
      filesToDownload.push(resolveTemplate(mediaTpl, bestRep.id, n));
    }
  }

  if (filesToDownload.length === 0) {
    throw new Error("No segments found in MPD manifest");
  }

  // Download all files
  for (const filename of filesToDownload) {
    const remoteUrl = filename.startsWith("http") ? filename : baseUrl + filename;
    try {
      const res = await safeFetch(remoteUrl);
      if (res.ok) {
        const data = await res.arrayBuffer();
        if (data.byteLength > 10) {
          const ct = filename.endsWith(".m4s") ? "video/iso.segment" :
                     filename.endsWith(".webm") ? "video/webm" :
                     filename.endsWith(".mp4") ? "video/mp4" : "application/octet-stream";
          await storage.put(`videos/${slug}/${filename}`, data, {
            httpMetadata: { contentType: ct, cacheControl: "public, max-age=31536000" },
          });
          segmentCount++;
        }
      } else if (res.status !== 404) {
        errors.push(`${filename}: HTTP ${res.status}`);
      }
    } catch (e: any) {
      errors.push(`${filename}: ${e.message}`);
    }
  }

  if (segmentCount === 0) {
    throw new Error(`No segments downloaded. Errors: ${errors.slice(0, 5).join("; ")}`);
  }

  // Rewrite MPD: remove Representations we didn't download, remove BaseURL
  let rewrittenMPD = mpdContent.replace(/<BaseURL>[^<]*<\/BaseURL>/gi, "");
  // Remove non-selected Representation blocks
  rewrittenMPD = rewrittenMPD.replace(
    /<Representation\b[^>]*>[\s\S]*?<\/Representation>/gi,
    (match) => {
      const id = extractAttr(match, "id");
      return (id && selectedRepIds.has(id)) ? match : "";
    }
  );

  const mpdPath = `videos/${slug}/manifest.mpd`;
  await storage.put(mpdPath, rewrittenMPD, {
    httpMetadata: { contentType: "application/dash+xml", cacheControl: "public, max-age=3600" },
  });

  return { path: mpdPath, segmentCount, errors };
}

/** Split MPD into AdaptationSet blocks (handles nested elements) */
function splitAdaptationSets(mpd: string): string[] {
  const results: string[] = [];
  let searchFrom = 0;
  while (true) {
    const start = mpd.indexOf("<AdaptationSet", searchFrom);
    if (start === -1) break;
    const end = mpd.indexOf("</AdaptationSet>", start);
    if (end === -1) break;
    results.push(mpd.substring(start, end + "</AdaptationSet>".length));
    searchFrom = end + "</AdaptationSet>".length;
  }
  return results;
}

function extractAttr(xml: string, attr: string): string | null {
  const regex = new RegExp(`${attr}="([^"]*)"`, "i");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

function resolveTemplate(template: string, repId: string, number: number): string {
  return template
    .replace(/\$RepresentationID\$/g, repId)
    .replace(/\$Number\$/g, String(number))
    .replace(/\$Number%(\d+)d\$/g, (_, pad) => String(number).padStart(parseInt(pad), "0"))
    .replace(/\$Bandwidth\$/g, "0")
    .replace(/\$Time\$/g, "0");
}

function parseDuration(iso: string): number {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || "0") * 3600) +
         (parseInt(match[2] || "0") * 60) +
         (parseFloat(match[3] || "0"));
}

