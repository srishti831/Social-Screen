import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Topbar from '../components/Topbar.jsx';
import { errorMessage, getStats } from '../services/api.js';
import { formatMinutes } from '../utils/format.js';

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <span className="stat-value">{value}</span>
      <span className="muted">{label}</span>
    </div>
  );
}

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getStats().then(setStats).catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return (<><Topbar /><main className="dashboard"><p className="form-error">{error}</p></main></>);
  if (!stats) return (<><Topbar /><main className="dashboard"><p className="muted">Loading...</p></main></>);

  const perDay = stats.messagesPerDay.map((d) => ({ day: d.date.slice(5), messages: d.count }));
  const watch = stats.topWatchRooms.map((r) => ({ room: r.roomId, minutes: r.minutes }));
  const chat = stats.topChatRooms.map((r) => ({ room: r.roomId, messages: r.count }));
  const axis = { stroke: 'var(--muted)', fontSize: 12 };
  const tip = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }, cursor: { fill: 'var(--accent-soft)' } };

  return (
    <>
      <Topbar />
      <main className="dashboard">
        <h1>My stats</h1>
        <div className="stat-grid">
          <StatCard label="Time in rooms" value={formatMinutes(stats.watchMinutes)} />
          <StatCard label="Rooms visited" value={stats.roomsVisited} />
          <StatCard label="Rooms hosted" value={stats.roomsHosted} />
          <StatCard label="Messages sent" value={stats.totalMessages} />
          <StatCard label="Joins" value={stats.totalJoins} />
          <StatCard label="Notes written" value={stats.notes} />
        </div>

        <section className="chart-card">
          <h2>Messages, last 14 days</h2>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perDay}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...tip} />
                <Bar dataKey="messages" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="dash-grid">
          <section className="chart-card">
            <h2>Most time spent (minutes)</h2>
            {watch.length === 0 ? <p className="empty">Join a room to see this.</p> : (
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={watch} layout="vertical">
                    <CartesianGrid stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} {...axis} />
                    <YAxis type="category" dataKey="room" width={70} {...axis} />
                    <Tooltip {...tip} />
                    <Bar dataKey="minutes" fill="var(--accent-2)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
          <section className="chart-card">
            <h2>Most active chats</h2>
            {chat.length === 0 ? <p className="empty">Send a message to see this.</p> : (
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chat} layout="vertical">
                    <CartesianGrid stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} {...axis} />
                    <YAxis type="category" dataKey="room" width={70} {...axis} />
                    <Tooltip {...tip} />
                    <Bar dataKey="messages" fill="var(--accent)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
