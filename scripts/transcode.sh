#!/bin/bash
# WTCHP — Video Transcoding Script
# Usage: ./scripts/transcode.sh <input_file> <output_dir> [slug]
#
# Prerequisites: ffmpeg must be installed
# This creates HLS segments at 720p, 480p, 360p with a master playlist
#
# Example:
#   ./scripts/transcode.sh video.mp4 output/ my-video-slug

set -e

INPUT="$1"
OUTPUT_DIR="$2"
SLUG="${3:-$(basename "$INPUT" | sed 's/\.[^.]*$//' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')}"

if [ -z "$INPUT" ] || [ -z "$OUTPUT_DIR" ]; then
  echo "Usage: $0 <input_file> <output_dir> [slug]"
  exit 1
fi

if ! command -v ffmpeg &> /dev/null; then
  echo "Error: ffmpeg is not installed"
  exit 1
fi

# Create output directories
mkdir -p "$OUTPUT_DIR/$SLUG/720p"
mkdir -p "$OUTPUT_DIR/$SLUG/480p"
mkdir -p "$OUTPUT_DIR/$SLUG/360p"

echo "🎬 Transcoding: $INPUT -> $OUTPUT_DIR/$SLUG/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Generate thumbnail
echo "📸 Generating thumbnail..."
ffmpeg -y -i "$INPUT" \
  -ss 00:00:05 -vframes 1 \
  -vf "scale=640:360" \
  "$OUTPUT_DIR/$SLUG/thumb.jpg" 2>/dev/null

# Get video duration
DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv="p=0" "$INPUT" | cut -d'.' -f1)
echo "⏱  Duration: ${DURATION}s"

# Multi-bitrate HLS encoding
echo "🔄 Encoding multi-bitrate HLS..."
ffmpeg -y -i "$INPUT" \
  -filter_complex "\
    [0:v]split=3[v720][v480][v360]; \
    [v720]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v720out]; \
    [v480]scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2[v480out]; \
    [v360]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[v360out]" \
  -map "[v720out]" -c:v:0 libx264 -b:v:0 2500k -maxrate:v:0 2675k -bufsize:v:0 5000k -preset fast -profile:v high -level 4.0 \
  -map "[v480out]" -c:v:1 libx264 -b:v:1 1000k -maxrate:v:1 1070k -bufsize:v:1 2000k -preset fast -profile:v main -level 3.1 \
  -map "[v360out]" -c:v:2 libx264 -b:v:2 500k -maxrate:v:2 535k -bufsize:v:2 1000k -preset fast -profile:v baseline -level 3.0 \
  -map a:0? -c:a:0 aac -b:a:0 128k -ac 2 \
  -map a:0? -c:a:1 aac -b:a:1 96k -ac 2 \
  -map a:0? -c:a:2 aac -b:a:2 64k -ac 2 \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
  -f hls \
  -hls_time 6 \
  -hls_list_size 0 \
  -hls_segment_type mpegts \
  -hls_segment_filename "$OUTPUT_DIR/$SLUG/%v/seg_%03d.ts" \
  -master_pl_name master.m3u8 \
  "$OUTPUT_DIR/$SLUG/%v/playlist.m3u8"

# Rename variant directories
mv "$OUTPUT_DIR/$SLUG/0" "$OUTPUT_DIR/$SLUG/720p_tmp" 2>/dev/null || true
mv "$OUTPUT_DIR/$SLUG/1" "$OUTPUT_DIR/$SLUG/480p_tmp" 2>/dev/null || true
mv "$OUTPUT_DIR/$SLUG/2" "$OUTPUT_DIR/$SLUG/360p_tmp" 2>/dev/null || true
rm -rf "$OUTPUT_DIR/$SLUG/720p" "$OUTPUT_DIR/$SLUG/480p" "$OUTPUT_DIR/$SLUG/360p"
mv "$OUTPUT_DIR/$SLUG/720p_tmp" "$OUTPUT_DIR/$SLUG/720p" 2>/dev/null || true
mv "$OUTPUT_DIR/$SLUG/480p_tmp" "$OUTPUT_DIR/$SLUG/480p" 2>/dev/null || true
mv "$OUTPUT_DIR/$SLUG/360p_tmp" "$OUTPUT_DIR/$SLUG/360p" 2>/dev/null || true

# Fix master playlist paths
sed -i.bak 's|0/|720p/|g; s|1/|480p/|g; s|2/|360p/|g' "$OUTPUT_DIR/$SLUG/master.m3u8" 2>/dev/null || \
  sed -i '' 's|0/|720p/|g; s|1/|480p/|g; s|2/|360p/|g' "$OUTPUT_DIR/$SLUG/master.m3u8"
rm -f "$OUTPUT_DIR/$SLUG/master.m3u8.bak"

echo ""
echo "✅ Transcoding complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📁 Output: $OUTPUT_DIR/$SLUG/"
echo "📄 Master: $OUTPUT_DIR/$SLUG/master.m3u8"
echo "📸 Thumb:  $OUTPUT_DIR/$SLUG/thumb.jpg"
echo "⏱  Duration: ${DURATION}s"
echo ""
echo "To upload to R2:"
echo "  npx wrangler r2 object put wtchp-storage/videos/$SLUG/ --file=$OUTPUT_DIR/$SLUG/ --recursive"
echo ""
echo "Video URL for DB: /api/stream/$SLUG/master.m3u8"
echo "Thumb URL for DB: /api/stream/thumb/$SLUG/thumb.jpg"
