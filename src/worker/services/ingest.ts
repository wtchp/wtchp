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

/**
 * Download a DASH stream (.mpd) and convert to HLS
 * - Parses MPD XML to find segment URLs
 * - Downloads init + media segments
 * - Creates HLS m3u8 manifests pointing to downloaded segments
 */
export async function ingestDASH(
  storage: R2Bucket,
  mpdUrl: string,
  slug: string
): Promise<{ path: string; segmentCount: number; errors: string[] }> {
  const errors: string[] = [];
  let segmentCount = 0;
  const baseUrl = mpdUrl.substring(0, mpdUrl.lastIndexOf("/") + 1);

  // Fetch MPD manifest
  const mpdRes = await safeFetch(mpdUrl);
  if (!mpdRes.ok) {
    throw new Error(`Failed to fetch MPD: ${mpdRes.status}`);
  }
  const mpdContent = await mpdRes.text();

  if (!mpdContent.includes("<MPD") && !mpdContent.includes("<mpd")) {
    throw new Error(`Invalid MPD manifest. Content: ${mpdContent.substring(0, 200)}`);
  }

  // Store original MPD for reference
  await storage.put(`videos/${slug}/original.mpd`, mpdContent, {
    httpMetadata: { contentType: "application/dash+xml" },
  });

  // Parse MPD to find representations
  const representations = parseMPD(mpdContent, baseUrl);

  if (representations.length === 0) {
    throw new Error("No representations found in MPD manifest");
  }

  // Pick the best video representation (highest bandwidth) and one audio
  const videoReps = representations.filter(r => r.mimeType.startsWith("video"));
  const audioReps = representations.filter(r => r.mimeType.startsWith("audio"));

  // Take up to 3 video qualities
  const selectedVideo = videoReps
    .sort((a, b) => b.bandwidth - a.bandwidth)
    .slice(0, 3);
  const selectedAudio = audioReps.slice(0, 1);

  const allSelected = [...selectedVideo, ...selectedAudio];

  if (allSelected.length === 0) {
    // Fallback: try to download all representations
    allSelected.push(...representations.slice(0, 3));
  }

  // Download segments for each representation and create variant playlists
  const variants: { dir: string; bandwidth: number; width: number; height: number; isAudio: boolean }[] = [];

  for (let i = 0; i < allSelected.length; i++) {
    const rep = allSelected[i];
    const variantDir = `variant_${i}`;
    const isAudio = rep.mimeType.startsWith("audio");

    try {
      // Download init segment if exists
      if (rep.initUrl) {
        const initRes = await safeFetch(rep.initUrl);
        if (initRes.ok) {
          const initData = await initRes.arrayBuffer();
          await storage.put(`videos/${slug}/${variantDir}/init.mp4`, initData, {
            httpMetadata: { contentType: rep.mimeType, cacheControl: "public, max-age=31536000" },
          });
        } else {
          errors.push(`Init segment failed: ${initRes.status}`);
        }
      }

      // Download media segments
      const playlistLines: string[] = [];
      playlistLines.push("#EXTM3U");
      playlistLines.push("#EXT-X-VERSION:7"); // v7 supports fMP4
      playlistLines.push(`#EXT-X-TARGETDURATION:${Math.ceil(rep.segmentDuration || 6)}`);
      playlistLines.push("#EXT-X-MEDIA-SEQUENCE:0");

      // fMP4 init segment reference
      if (rep.initUrl) {
        playlistLines.push(`#EXT-X-MAP:URI="init.mp4"`);
      }

      for (let s = 0; s < rep.segmentUrls.length; s++) {
        const segUrl = rep.segmentUrls[s];
        const segExt = segUrl.includes(".m4s") ? "m4s" : segUrl.includes(".mp4") ? "mp4" : "m4s";
        const segFilename = `seg_${s}.${segExt}`;

        try {
          const segRes = await safeFetch(segUrl);
          if (segRes.ok) {
            const segData = await segRes.arrayBuffer();
            if (segData.byteLength > 50) {
              await storage.put(`videos/${slug}/${variantDir}/${segFilename}`, segData, {
                httpMetadata: {
                  contentType: isAudio ? "audio/mp4" : "video/mp4",
                  cacheControl: "public, max-age=31536000",
                },
              });
              const duration = rep.segmentDurations?.[s] || rep.segmentDuration || 6;
              playlistLines.push(`#EXTINF:${duration.toFixed(3)},`);
              playlistLines.push(segFilename);
              segmentCount++;
            } else {
              errors.push(`Segment too small: seg_${s} (${segData.byteLength}b)`);
            }
          } else {
            errors.push(`Segment ${s}: HTTP ${segRes.status}`);
          }
        } catch (e: any) {
          errors.push(`Segment ${s}: ${e.message}`);
        }
      }

      playlistLines.push("#EXT-X-ENDLIST");

      // Save variant playlist as HLS
      await storage.put(`videos/${slug}/${variantDir}/playlist.m3u8`, playlistLines.join("\n"), {
        httpMetadata: { contentType: "application/vnd.apple.mpegurl" },
      });

      variants.push({
        dir: variantDir,
        bandwidth: rep.bandwidth,
        width: rep.width || 0,
        height: rep.height || 0,
        isAudio,
      });
    } catch (e: any) {
      errors.push(`Variant ${i}: ${e.message}`);
    }
  }

  if (segmentCount === 0) {
    throw new Error(`No segments downloaded. Errors: ${errors.slice(0, 5).join("; ")}`);
  }

  // Create master HLS playlist
  const hasAudio = variants.some(v => v.isAudio);
  const masterLines: string[] = ["#EXTM3U"];

  // Define audio track first
  for (const v of variants) {
    if (v.isAudio) {
      masterLines.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="${v.dir}/playlist.m3u8"`);
    }
  }

  // Define video streams with audio reference
  for (const v of variants) {
    if (!v.isAudio) {
      const resolution = v.width && v.height ? `,RESOLUTION=${v.width}x${v.height}` : "";
      const audioRef = hasAudio ? `,AUDIO="audio"` : "";
      masterLines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth}${resolution}${audioRef}`);
      masterLines.push(`${v.dir}/playlist.m3u8`);
    }
  }

  const masterPath = `videos/${slug}/master.m3u8`;
  await storage.put(masterPath, masterLines.join("\n"), {
    httpMetadata: { contentType: "application/vnd.apple.mpegurl" },
  });

  return { path: masterPath, segmentCount, errors };
}

/**
 * Parse an MPD manifest (XML) to extract segment URLs
 * Handles: SegmentTemplate with $Number$, SegmentList, and direct BaseURL
 */
function parseMPD(mpd: string, baseUrl: string): DASHRepresentation[] {
  const reps: DASHRepresentation[] = [];

  // Extract all AdaptationSet blocks
  const adaptationSets = extractBlocks(mpd, "AdaptationSet");

  for (const adaptSet of adaptationSets) {
    const asMimeType = extractAttr(adaptSet, "mimeType") || "";
    const asContentType = extractAttr(adaptSet, "contentType") || "";
    const asCodecs = extractAttr(adaptSet, "codecs") || "";

    // Determine if this is audio or video
    // Check: mimeType, contentType attribute, codecs (mp4a/aac = audio), or Representation mimeType
    const isAudioAdaptSet =
      asMimeType.startsWith("audio") ||
      asContentType === "audio" ||
      asCodecs.startsWith("mp4a") ||
      asCodecs.startsWith("aac") ||
      (adaptSet.includes('mimeType="audio') && !adaptSet.includes('mimeType="video'));

    const mimeType = asMimeType ||
      (isAudioAdaptSet ? "audio/mp4" :
       asContentType.includes("video") ? "video/mp4" :
       asContentType.includes("audio") ? "audio/mp4" :
       "video/mp4");

    // Get SegmentTemplate at AdaptationSet level
    const asTemplate = extractBlock(adaptSet, "SegmentTemplate");
    const asTimescale = parseInt(extractAttr(asTemplate || "", "timescale") || "1");
    const asInitTemplate = extractAttr(asTemplate || "", "initialization") || "";
    const asMediaTemplate = extractAttr(asTemplate || "", "media") || "";
    const asStartNumber = parseInt(extractAttr(asTemplate || "", "startNumber") || "1");

    // Parse SegmentTimeline at AdaptationSet level
    const asTimeline = parseSegmentTimeline(asTemplate || "", asTimescale);

    // Extract Representation blocks
    const repBlocks = extractBlocks(adaptSet, "Representation");

    for (const repBlock of repBlocks) {
      const repId = extractAttr(repBlock, "id") || "1";
      const bandwidth = parseInt(extractAttr(repBlock, "bandwidth") || "0");
      const width = parseInt(extractAttr(repBlock, "width") || "0");
      const height = parseInt(extractAttr(repBlock, "height") || "0");
      const repMimeType = extractAttr(repBlock, "mimeType") || mimeType;

      // Check for Representation-level SegmentTemplate
      const repTemplate = extractBlock(repBlock, "SegmentTemplate");
      const template = repTemplate || asTemplate || "";

      const timescale = parseInt(extractAttr(template, "timescale") || String(asTimescale));
      const initTemplate = extractAttr(template, "initialization") || asInitTemplate;
      const mediaTemplate = extractAttr(template, "media") || asMediaTemplate;
      const startNumber = parseInt(extractAttr(template, "startNumber") || String(asStartNumber));

      // Parse timeline (Rep-level takes precedence)
      const timeline = repTemplate ? parseSegmentTimeline(repTemplate, timescale) : asTimeline;

      // Resolve BaseURL
      const repBaseUrl = extractInnerText(repBlock, "BaseURL");
      const adaptBaseUrl = extractInnerText(adaptSet, "BaseURL");
      const effectiveBase = repBaseUrl
        ? (repBaseUrl.startsWith("http") ? repBaseUrl : baseUrl + repBaseUrl)
        : adaptBaseUrl
          ? (adaptBaseUrl.startsWith("http") ? adaptBaseUrl : baseUrl + adaptBaseUrl)
          : baseUrl;

      const rep: DASHRepresentation = {
        id: repId,
        bandwidth,
        width,
        height,
        mimeType: repMimeType,
        initUrl: "",
        segmentUrls: [],
        segmentDuration: 0,
        segmentDurations: [],
      };

      if (mediaTemplate && timeline.length > 0) {
        // SegmentTemplate + SegmentTimeline
        if (initTemplate) {
          rep.initUrl = resolveTemplate(initTemplate, repId, 0, 0, effectiveBase);
        }

        let segNum = startNumber;
        for (const seg of timeline) {
          const url = resolveTemplate(mediaTemplate, repId, segNum, seg.time, effectiveBase);
          rep.segmentUrls.push(url);
          rep.segmentDurations!.push(seg.duration / timescale);
          segNum++;
        }
        rep.segmentDuration = timeline.length > 0 ? timeline[0].duration / timescale : 6;
      } else if (mediaTemplate) {
        // SegmentTemplate with duration (no timeline)
        const segDuration = parseInt(extractAttr(template, "duration") || "0");
        const totalDuration = parseDuration(extractAttr(mpd, "mediaPresentationDuration") || "");

        if (initTemplate) {
          rep.initUrl = resolveTemplate(initTemplate, repId, 0, 0, effectiveBase);
        }

        if (segDuration > 0 && totalDuration > 0) {
          const numSegments = Math.ceil(totalDuration / (segDuration / timescale));
          rep.segmentDuration = segDuration / timescale;
          for (let n = startNumber; n < startNumber + numSegments; n++) {
            rep.segmentUrls.push(resolveTemplate(mediaTemplate, repId, n, (n - startNumber) * segDuration, effectiveBase));
            rep.segmentDurations!.push(segDuration / timescale);
          }
        }
      } else {
        // SegmentList or direct BaseURL
        const segListBlock = extractBlock(repBlock, "SegmentList") || extractBlock(adaptSet, "SegmentList") || "";
        if (segListBlock) {
          const initSrc = extractAttr(extractBlock(segListBlock, "Initialization") || "", "sourceURL");
          if (initSrc) {
            rep.initUrl = initSrc.startsWith("http") ? initSrc : effectiveBase + initSrc;
          }
          const segUrls = [...segListBlock.matchAll(/sourceURL="([^"]+)"/g)];
          // Skip the first if it was the init
          for (const m of segUrls) {
            if (m[1] === initSrc) continue;
            const url = m[1].startsWith("http") ? m[1] : effectiveBase + m[1];
            rep.segmentUrls.push(url);
          }
          rep.segmentDuration = parseInt(extractAttr(segListBlock, "duration") || "0") / timescale || 6;
        }
      }

      if (rep.segmentUrls.length > 0) {
        reps.push(rep);
      }
    }
  }

  return reps;
}

interface DASHRepresentation {
  id: string;
  bandwidth: number;
  width: number;
  height: number;
  mimeType: string;
  initUrl: string;
  segmentUrls: string[];
  segmentDuration: number;
  segmentDurations?: number[];
}

function extractBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>|<${tag}[^>]*\\/>`, "gi");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

function extractBlock(xml: string, tag: string): string | null {
  const blocks = extractBlocks(xml, tag);
  return blocks.length > 0 ? blocks[0] : null;
}

function extractAttr(xml: string, attr: string): string | null {
  const regex = new RegExp(`${attr}="([^"]*)"`, "i");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

function extractInnerText(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([^<]+)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function resolveTemplate(template: string, repId: string, number: number, time: number, baseUrl: string): string {
  let url = template
    .replace(/\$RepresentationID\$/g, repId)
    .replace(/\$Number\$/g, String(number))
    .replace(/\$Number%(\d+)d\$/g, (_, pad) => String(number).padStart(parseInt(pad), "0"))
    .replace(/\$Time\$/g, String(time))
    .replace(/\$Bandwidth\$/g, "0");
  if (!url.startsWith("http")) {
    url = baseUrl + url;
  }
  return url;
}

function parseSegmentTimeline(templateBlock: string, timescale: number): { time: number; duration: number }[] {
  const segments: { time: number; duration: number }[] = [];
  const sMatches = [...templateBlock.matchAll(/<S\s+([^/>]+)\/?\s*>/gi)];
  let currentTime = 0;

  for (const m of sMatches) {
    const attrs = m[1];
    const t = parseInt(attrs.match(/t="(\d+)"/)?.[1] || String(currentTime));
    const d = parseInt(attrs.match(/d="(\d+)"/)?.[1] || "0");
    const r = parseInt(attrs.match(/r="(\d+)"/)?.[1] || "0");

    currentTime = t;
    for (let i = 0; i <= r; i++) {
      segments.push({ time: currentTime, duration: d });
      currentTime += d;
    }
  }

  return segments;
}

function parseDuration(iso: string): number {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || "0") * 3600) +
         (parseInt(match[2] || "0") * 60) +
         (parseFloat(match[3] || "0"));
}

