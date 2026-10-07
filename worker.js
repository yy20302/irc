// Cloudflare Workers 版 IRC 中转 API
// 支持多服务器：玩家上报 serverId，按 server 查询同服务器玩家

const messages = [];
const MAX_MESSAGES = 100;
const users = new Map();      // key: user, value: { user, ansn, servers: Set, seen, lastSeen }
const serverSeen = new Map(); // key: `${serverId}__${user}`, value: lastSeen timestamp

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
      servers: new Set(),
      seen: Date.now(),
      lastSeen: Date.now(),
      messages: 0,
    };
    users.set(key, item);
  }
  return item;
}

function rememberUser(user, ansn, serverId) {
  const item = ensureUser(user);
  if (!item) return null;

  if (ansn === true || ansn === 'true') {
    item.ansn = true;
  }

  if (serverId) {
    item.servers.add(serverId);
    serverSeen.set(`${serverId}__${item.user}`, Date.now());
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
    servers: Array.from(item.servers || [])
  }));
}

function usersInServer(serverId) {
  return Array.from(users.values())
    .filter((item) => (item.servers || new Set()).has(serverId))
    .map((item) => ({
      user: item.user,
      ansn: item.ansn,
      display: displayName(item.user, item.ansn),
      lastSeen: new Date(item.lastSeen).toISOString(),
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

  for (const [key, ts] of serverSeen) {
    if (now - ts > CLEANUP_THRESHOLD_MS) {
      serverSeen.delete(key);
    }
  }
}

// 防止 setInterval 在 Workers 里被多次调用
let cleanupTimer = null;
function ensureCleanup() {
  if (cleanupTimer === null) {
    cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  }
}
ensureCleanup();

export default {
  async fetch(request, env) {
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
        serverCount: new Set(Array.from(users.values()).flatMap(u => u.servers || [])).size,
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

    // 玩家加入 / 心跳：上报 玩家 + 所在服务器
    if (url.pathname === '/api/irc/join' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
      }

      const user = String(body.user || body.name || 'roblox_player').trim();
      const serverId = String(body.serverId || body.server || '').trim();
      const ansn = body.ansn === true || body.ansn === 'true';

      if (!user || user === 'roblox_player') {
        return Response.json({ ok: false, error: 'user is required' }, { status: 400 });
      }

      const item = rememberUser(user, ansn, serverId || undefined);
      if (!item) {
        return Response.json({ ok: false, error: 'user is required' }, { status: 400 });
      }

      return Response.json({
        ok: true,
        user: user,
        serverId: serverId || null,
        ansn: item.ansn,
        display: displayName(user, item.ansn),
        usersInServer: serverId ? usersInServer(serverId) : [],
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
      const serverId = String(body.serverId || body.server || '').trim();

      if (user) {
        const item = users.get(user);
        if (item) {
          if (serverId) item.servers.delete(serverId);
          item.servers.delete(serverId);
          serverSeen.delete(`${serverId}__${user}`);

          // 如果没有任何服务器了，可以保留用户记录（ansn 可能仍需要）
          if (item.servers.size === 0) {
            // 保留用户，因为 ansn 状态可能仍需要显示
          }
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
      const serverId = String(body.serverId || '').trim();

      const item = ensureUser(user);
      if (item) {
        item.ansn = ansn;
        if (serverId) {
          item.servers.add(serverId);
          serverSeen.set(`${serverId}__${item.user}`, Date.now());
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

    // 查询同服务器的玩家（含 ansn 标记）
    if (url.pathname === '/api/irc/server' && request.method === 'GET') {
      const serverId = url.searchParams.get('serverId') || '';
      if (!serverId) {
        return Response.json({ ok: false, error: 'serverId is required' }, { status: 400 });
      }

      const list = usersInServer(serverId);
      return Response.json({
        ok: true,
        serverId: serverId,
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
