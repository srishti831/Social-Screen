import { useState } from 'react';
import { errorMessage, updateRoom } from '../services/api.js';
import { MOD_PERMISSION_LABELS } from '../utils/permissions.js';

/** Host-only: room name, visibility, password, max people and what moderators may do. */
export default function RoomSettingsModal({ roomId, settings, onClose, onSaved }) {
  const [name, setName] = useState(settings.name || '');
  const [isPublic, setIsPublic] = useState(settings.isPublic);
  const [maxUsers, setMaxUsers] = useState(settings.maxUsers);
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [perms, setPerms] = useState({ ...settings.modPermissions });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setError('');
    const patch = { name, isPublic, maxUsers: Number(maxUsers), modPermissions: perms };
    if (removePassword) patch.password = null;
    else if (password) patch.password = password;
    setBusy(true);
    try {
      await updateRoom(roomId, patch);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onSubmit={save} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Room settings">
        <h2>Room settings</h2>
        <label>Room name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Movie night" /></label>
        <label className="check"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Public (listed on the Public rooms page)</label>
        <label>Max people<input type="number" min="2" max="50" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} /></label>
        <label>
          Password {settings.hasPassword && <span className="muted">(one is set)</span>}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={settings.hasPassword ? 'Type a new password to change it' : 'Optional, 4+ characters'} minLength={4} maxLength={50} disabled={removePassword} autoComplete="new-password" />
        </label>
        {settings.hasPassword && (
          <label className="check"><input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} /> Remove the password</label>
        )}
        <fieldset>
          <legend>What moderators may do</legend>
          {Object.entries(MOD_PERMISSION_LABELS).map(([key, label]) => (
            <label key={key} className="check">
              <input type="checkbox" checked={Boolean(perms[key])} onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.checked }))} /> {label}
            </label>
          ))}
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="row-gap">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
