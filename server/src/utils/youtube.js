const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Accepts a YouTube URL (watch, youtu.be, embed, shorts, live) or a bare 11-char id. */
export function parseVideoId(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = match ? match[1] : null;
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Best-effort title via YouTube oEmbed (no API key). Returns null on any failure. */
export async function fetchVideoTitle(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.title === 'string' ? data.title.slice(0, 120) : null;
  } catch {
    return null;
  }
}
