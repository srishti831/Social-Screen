export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const formatClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function timeAgo(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export const thumbnail = (videoId) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

export const ROLE_LABEL = { host: 'Host', moderator: 'Moderator', participant: 'Participant' };

export function describeRequest(request) {
  switch (request.type) {
    case 'play':
      return 'Play the video';
    case 'pause':
      return 'Pause the video';
    case 'seek':
      return `Jump to ${formatTime(request.payload?.time)}`;
    case 'change_video':
      return `Switch video (${request.payload?.videoId})`;
    default:
      return request.type;
  }
}

export const whatsappLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
