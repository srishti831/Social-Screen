import axios from 'axios';
import { API_URL } from './config.js';

// withCredentials = the browser sends/receives the httpOnly auth cookies. The JWT never touches JavaScript.
const api = axios.create({ baseURL: API_URL, withCredentials: true });

const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/google', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email'];
let refreshing = null; // one refresh at a time; parallel 401s all wait for the same call

// On 401 the short-lived access token has probably expired: refresh once, then retry the request.
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { config, response } = error;
    if (response?.status !== 401 || !config || config._retried || NO_REFRESH.some((u) => config.url?.startsWith(u))) {
      return Promise.reject(error);
    }
    config._retried = true;
    try {
      refreshing ||= api.post('/auth/refresh').finally(() => {
        refreshing = null;
      });
      await refreshing;
    } catch {
      window.dispatchEvent(new Event('auth:expired')); // refresh failed: the session is really over
      return Promise.reject(error);
    }
    return api(config); // retry the original request with the new cookies
  }
);

export const errorMessage = (error) =>
  error.response?.data?.message || (error.request ? 'Cannot reach the server. Try again in a moment.' : error.message);
export const errorCode = (error) => error.response?.data?.code;

const data = (r) => r.data;

// auth
export const register = (body) => api.post('/auth/register', body).then(data);
export const login = (body) => api.post('/auth/login', body).then(data);
export const googleLogin = (credential) => api.post('/auth/google', { credential }).then(data);
export const logout = () => api.post('/auth/logout').catch(() => {});
export const fetchMe = () => api.get('/auth/me').then((r) => r.data.user);
export const verifyEmail = (token) => api.post('/auth/verify-email', { token }).then(data);
export const resendVerification = () => api.post('/auth/resend-verification').then(data);
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email }).then(data);
export const resetPassword = (token, password) => api.post('/auth/reset-password', { token, password }).then(data);
export const getWsTicket = (roomId, password) =>
  api.post('/auth/ws-ticket', { roomId, ...(password ? { password } : {}) }).then((r) => r.data.ticket);

// rooms
export const createRoom = (settings) => api.post('/rooms', settings).then((r) => r.data.room);
export const getRoom = (roomId) => api.get(`/rooms/${roomId}`).then((r) => r.data.room);
export const updateRoom = (roomId, patch) => api.patch(`/rooms/${roomId}`, patch).then((r) => r.data.settings);
export const deleteRoom = (roomId) => api.delete(`/rooms/${roomId}`).then(data);
export const listPublicRooms = () => api.get('/rooms/public').then((r) => r.data.rooms);
export const listMyRooms = () => api.get('/rooms/mine').then((r) => ({ hosted: r.data.hosted, recent: r.data.recent }));
export const getMessages = (roomId, params) => api.get(`/rooms/${roomId}/messages`, { params }).then((r) => r.data.messages);

// stats
export const getStats = () => api.get('/stats/me').then((r) => r.data.stats);

export default api;
