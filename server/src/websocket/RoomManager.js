import { Room } from './Room.js';
import { DEFAULT_OPTIONS } from './constants.js';
import { persistence as defaultPersistence } from '../services/persistence.js';

/** Owns all active (in-memory) rooms and loads/unloads them from MongoDB. */
export class RoomManager {
  constructor({ options = {}, persistence = defaultPersistence } = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.persistence = persistence;
    this.rooms = new Map();
    this.loading = new Map(); // roomId -> Promise, so two joins don't load the same room twice
  }

  /** Logs database failures instead of crashing a live room. */
  safe(promise, what) {
    Promise.resolve(promise).catch((err) => console.error(`Failed to ${what}`, err));
  }

  createRoom({ roomId, hostId, playback, settings, queue }) {
    const room = new Room({
      roomId,
      hostId,
      playback,
      settings,
      queue,
      options: this.options,
      hooks: {
        onEmpty: (r) => this.scheduleEviction(r),
        onHostChange: (r) => this.safe(this.persistence.saveHost(r.roomId, r.hostId), `save host for ${r.roomId}`),
        onQueueChange: (r) => this.safe(this.persistence.saveQueue(r.roomId, r.queue), `save queue for ${r.roomId}`),
        onVideoChange: (r) => this.safe(this.persistence.saveVideo(r.roomId, r.playback.videoId), `save video for ${r.roomId}`),
        onLeave: (r, p) =>
          this.safe(this.persistence.recordLeave(p.userId, r.roomId, (Date.now() - p.joinedAt) / 1000), `save watch time for ${r.roomId}`),
      },
    });
    this.rooms.set(roomId, room);
    this.scheduleEviction(room); // evicted again if nobody joins
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  /** Memory first; otherwise rehydrate from MongoDB (paused, at the last saved video/time). */
  async getOrLoadRoom(roomId) {
    const active = this.rooms.get(roomId);
    if (active) return active;
    if (this.loading.has(roomId)) return this.loading.get(roomId);

    const loadPromise = (async () => {
      const record = await this.persistence.findRoom(roomId);
      if (!record) return null;
      return this.createRoom({
        roomId,
        hostId: record.hostId,
        playback: { videoId: record.videoId, currentTime: record.currentTime },
        settings: record,
        queue: record.queue,
      });
    })().finally(() => this.loading.delete(roomId));

    this.loading.set(roomId, loadPromise);
    return loadPromise;
  }

  /** Active public rooms with at least one person inside (the "Public rooms" page). */
  listPublicRooms() {
    return [...this.rooms.values()]
      .filter((r) => r.settings.isPublic && r.participants.size > 0 && !r.closed)
      .map((r) => ({
        roomId: r.roomId,
        name: r.settings.name,
        hostName: r.hostName(),
        participantCount: r.participants.size,
        maxUsers: r.settings.maxUsers,
        hasPassword: Boolean(r.settings.passwordHash),
        videoId: r.playback.videoId,
      }))
      .sort((a, b) => b.participantCount - a.participantCount);
  }

  /** Removes a room for good (host deleted it) and disconnects everyone inside. */
  closeRoom(roomId, message) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    this.rooms.delete(roomId);
    room.close(message);
    return true;
  }

  scheduleEviction(room) {
    clearTimeout(room.evictTimer);
    room.evictTimer = setTimeout(() => this.evict(room), this.options.emptyRoomMs);
    room.evictTimer.unref?.();
  }

  cancelEviction(room) {
    clearTimeout(room.evictTimer);
    room.evictTimer = null;
  }

  /** Frees memory for an empty room. The MongoDB record stays so the link keeps working. */
  async evict(room) {
    if (room.participants.size > 0 || this.rooms.get(room.roomId) !== room) return;
    this.rooms.delete(room.roomId);
    room.destroy();
    try {
      await this.persistence.saveSnapshot(room.roomId, {
        videoId: room.playback.videoId,
        currentTime: room.getExpectedTime(),
        hostId: room.hostId,
      });
    } catch (err) {
      console.error(`Failed to save room ${room.roomId}`, err);
    }
  }

  shutdown() {
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }
}
