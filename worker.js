// Cloudflare Workers 版 IRC 中转 API
// 支持房间匹配：玩家上报 player + roomId，再按 roomId 查询同一房间内的调用者

const messages = [];
const MAX_MESSAGES = 100;
const users = new Map();      // key: user, value: { user, ansn, servers: Set, seen, lastSeen }
const roomSeen = new Map();   // key: `${roomId}__${user}`, value: lastSeen timestamp

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const CLEANUP_THRESHOLD_MS = 5 * 60 * 1000;
const HEARTBEAT_THRESHOLD_MS = 30 * 1000;

function displayName(user, ansn) {
  return ansn ? user + ' (ansn)' : user;
}

function ensureUser(user) {
  const key = String(user).trim();
  if (!key || key === 'roblox_player') return null;

  let item = users.get(key);
  if (!item) {
    item = {
      user: key,
      ansn: false,
      rooms: new Set(),
      seen: Date.now(),
      lastSeen: Date.now(),
      messages: 0,
    };
    users.set(key, item);
  }
  return item;
}

function rememberUser(user, ansn, roomId) {
  const item = ensureUser(user);
  if (!item) return null;

  if (ansn === true || ansn === 'true') {
    item.ansn = true;
  }

  if (roomId) {
    item.rooms.add(roomId);
    roomSeen.set(`${roomId}__${item.user}`, Date.now());
  }

  item.lastSeen = Date.now();
  if (!item.seen) item.seen = Date.now();
  return item;
}

function userSnapshot() {
  return Array.from(users.values()).map((item) => ({
    user: item.user,
    ansn: item.ansn,
    display: displayName(item.user, item.ansn),
    seen: new Date(item.seen || item.lastSeen).toISOString(),
    lastSeen: new Date(item.lastSeen).toISOString(),
    messages: item.messages || 0,
    rooms: Array.from(item.rooms || []),
  }));
}

function usersInRoom(roomId) {
  return Array.from(users.values())
    .filter((item) => (item.rooms || new Set()).has(roomId))
    .map((item) => ({
      user: item.user,
      ansn: item.ansn,
      display: displayName(item.user, item.ansn),
      lastSeen: new Date(item.lastSeen).toISOString(),
      rooms: Array.from(item.rooms || []),
    }));
}

function pushMessage(data) {
  messages.push({
    id: Date.now() + '_' + Math.random().toString(36).slice(2),
    ...data,
    time: new Date().toISOString(),
  });
  if (messages.length > MAX_MESSAGES) messages.shift();
}

function cleanup() {
  const now = Date.now();

  for (const [key, item] of users) {
    const idle = now - (item.lastSeen || now);
    if (idle > CLEANUP_THRESHOLD_MS) {
      users.delete(key);
    }
  }

  for (const [key, ts] of roomSeen) {
    if (now - ts > CLEANUP_THRESHOLD_MS) {
      roomSeen.delete(key);
    }
  }
}

function maybeCleanup() {
  // 用全局节流，每次请求进来时按 30 分钟触发一次清理
  const now = Date.now();
  if (typeof globalThis.__ircCleanupLast !== 'number') {
    globalThis.__ircCleanupLast = 0;
  }
  if (now - globalThis.__ircCleanupLast < CLEANUP_INTERVAL_MS) return;
  globalThis.__ircCleanupLast = now;
  cleanup();
}

export default {
  async fetch(request, env) {
    maybeCleanup();
    const url = new URL(request.url);
    const enableIrc = String(env.ENABLE_IRC || 'true').toLowerCase() !== 'false';
    const ircChannels = (env.IRC_CHANNELS || '#general,#random').split(',');

    if (url.pathname === '/' || url.pathname === '/api/irc/status') {
      return Response.json({
        ok: true,
        service: 'roblox-irc-api',
        ircEnabled: enableIrc,
        messageCount: messages.length,
        userCount: users.size,
        roomCount: new Set(Array.from(users.values()).flatMap(u => u.rooms || [])).size,
        channels: ircChannels,
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 玩家加入 / 心跳：上报 玩家 + 所在房间
    if (url.pathname === '/api/irc/join' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
      }

      const user = String(body.user || body.name || 'roblox_player').trim();
      const roomId = String(body.roomId || body.serverId || body.room || body.server || '').trim();
      const ansn = body.ansn === true || body.ansn === 'true';

      if (!user || user === 'roblox_player') {
        return Response.json({ ok: false, error: 'user is required' }, { status: 400 });
      }

      const item = rememberUser(user, ansn, roomId || undefined);
      if (!item) {
        return Response.json({ ok: false, error: 'user is required' }, { status: 400 });
      }

      return Response.json({
        ok: true,
        user: user,
        roomId: roomId || null,
        ansn: item.ansn,
        display: displayName(user, item.ansn),
        usersInRoom: roomId ? usersInRoom(roomId) : [],
        users: userSnapshot(),
      });
    }

    // 玩家离开
    if (url.pathname === '/api/irc/leave' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
      }

      const user = String(body.user || body.name || '').trim();
      const roomId = String(body.roomId || body.serverId || body.room || body.server || '').trim();

      if (user && roomId) {
        const item = users.get(user);
        if (item) {
          item.rooms.delete(roomId);
          roomSeen.delete(`${roomId}__${user}`);
        }
      }

      return Response.json({ ok: true, user: user, users: userSnapshot() });
    }

    // 手动设置 ansn
    if (url.pathname === '/api/irc/ansn' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
      }

      const user = String(body.user || '').trim();
      const ansn = body.ansn === true || body.ansn === 'true';
      const roomId = String(body.roomId || body.serverId || body.room || body.server || '').trim();

      const item = ensureUser(user);
      if (item) {
        item.ansn = ansn;
        if (roomId) {
          item.rooms.add(roomId);
          roomSeen.set(`${roomId}__${item.user}`, Date.now());
        }
        item.lastSeen = Date.now();
      }

      return Response.json({
        ok: true,
        user: user,
        ansn: item ? item.ansn : false,
        users: userSnapshot(),
      });
    }

    // 查询同房间的玩家（含 ansn 标记）
    if (url.pathname === '/api/irc/room' && request.method === 'GET') {
      const roomId = url.searchParams.get('roomId') || url.searchParams.get('serverId') || '';
      if (!roomId) {
        return Response.json({ ok: false, error: 'roomId is required' }, { status: 400 });
      }

      const list = usersInRoom(roomId);
      return Response.json({
        ok: true,
        roomId: roomId,
        count: list.length,
        users: list,
        ansnUsers: list.filter((u) => u.ansn),
      });
    }

    // 兼容旧接口
    if (url.pathname === '/api/irc/server' && request.method === 'GET') {
      const roomId = url.searchParams.get('serverId') || url.searchParams.get('roomId') || '';
      if (!roomId) {
        return Response.json({ ok: false, error: 'serverId is required' }, { status: 400 });
      }

      const list = usersInRoom(roomId);
      return Response.json({
        ok: true,
        serverId: roomId,
        roomId: roomId,
        count: list.length,
        users: list,
        ansnUsers: list.filter((u) => u.ansn),
      });
    }

    // 查询所有 ansn
    if (url.pathname === '/api/irc/ansn' && request.method === 'GET') {
      return Response.json({
        ok: true,
        users: userSnapshot(),
        ansnUsers: userSnapshot().filter((item) => item.ansn),
      });
    }

    // 查询所有用户
    if (url.pathname === '/api/irc/users' && request.method === 'GET') {
      return Response.json({ ok: true, users: userSnapshot() });
    }

    // 拉取最近消息
    if (url.pathname === '/api/irc/messages' && request.method === 'GET') {
      return Response.json({ ok: true, messages: messages.slice(-50) });
    }

    // 发送消息
    if (url.pathname === '/api/irc/send' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
      }

      const channel = body.channel || ircChannels[0];
      const user = String(body.user || 'roblox_player').trim();
      const text = String(body.message || '').trim();

      if (!text) {
        return Response.json({ ok: false, error: 'message is required' }, { status: 400 });
      }

      pushMessage({
        channel,
        user,
        text,
        local: true,
        ircEnabled: enableIrc,
      });

      return Response.json({ ok: true, message: { channel, user, text, time: new Date().toISOString() } });
    }

    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  },
};
