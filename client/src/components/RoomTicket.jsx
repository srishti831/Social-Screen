import { useState } from 'react';
import { whatsappLink } from '../utils/format.js';

/** The room code drawn as a ticket stub, with invite sharing (copy link + WhatsApp). */
export default function RoomTicket({ roomId, roomName, hasPassword, onCopied }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/watch/${roomId}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      onCopied?.('Invite link copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onCopied?.(link); // clipboard blocked (non-HTTPS / permissions): at least show the link
    }
  }

  // The room password is never put into the message: tell people to ask the host for it.
  const text = `Join me on Social - Screen${roomName ? ` "${roomName}"` : ''}! 🍿\n${link}${hasPassword ? '\n(The room is password protected, ask me for the password.)' : ''}`;

  return (
    <div className="ticket">
      <div className="ticket-main">
        <span className="ticket-label">Room code</span>
        <span className="ticket-code">{roomId}</span>
      </div>
      <button type="button" className="ticket-stub" onClick={copyLink}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <a className="ticket-stub ticket-wa" href={whatsappLink(text)} target="_blank" rel="noopener noreferrer">
        WhatsApp
      </a>
    </div>
  );
}
