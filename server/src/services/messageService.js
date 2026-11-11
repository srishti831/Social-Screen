import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Note from '../models/Note.js';

/** Same shape the live `chat_message` event uses, so history and live messages look identical. */
export const toChat = (doc) => ({
  id: String(doc._id),
  userId: String(doc.userId),
  username: doc.username,
  message: doc.text,
  timestamp: new Date(doc.createdAt).getTime(),
});

export async function saveMessage({ roomId, userId, username, text }) {
  return toChat(await Message.create({ roomId, userId, username, text }));
}

/**
 * Newest-first page, returned oldest-first for display.
 * `before` is a message id (cursor) or an ISO date; without it you get the latest messages.
 */
export async function getMessages(roomId, { before, limit = 50 } = {}) {
  const filter = { roomId };
  if (before) {
    if (mongoose.isValidObjectId(before)) filter._id = { $lt: before };
    else if (!Number.isNaN(Date.parse(before))) filter.createdAt = { $lt: new Date(before) };
  }
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const docs = await Message.find(filter).sort({ _id: -1 }).limit(size).lean();
  return docs.reverse().map(toChat);
}

// ---------- notes ----------

export const toNote = (doc) => ({
  id: String(doc._id),
  userId: String(doc.userId),
  username: doc.username,
  text: doc.text,
  videoId: doc.videoId,
  videoTime: doc.videoTime,
  createdAt: new Date(doc.createdAt).getTime(),
});

export async function createNote({ roomId, userId, username, text, videoId, videoTime }) {
  return toNote(await Note.create({ roomId, userId, username, text, videoId, videoTime }));
}

export async function listNotes(roomId, limit = 100) {
  const docs = await Note.find({ roomId }).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.reverse().map(toNote);
}

export async function findNote(noteId) {
  if (!mongoose.isValidObjectId(noteId)) return null;
  const doc = await Note.findById(noteId).lean();
  return doc && { ...toNote(doc), roomId: doc.roomId };
}

export const deleteNote = (noteId) => Note.deleteOne({ _id: noteId });
