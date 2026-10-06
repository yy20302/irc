// Cloudflare Workers 版 IRC 中转 API
// 不需要 Git、不需要信用卡、不依赖 npm、不依赖 express。
// 粘贴到 https://dash.cloudflare.com -> Workers -> 新建 Worker -> 粘贴 -> Deploy 即可。

// 最近消息缓存（Workers 实例级，重启会清空）
const messages = [];
const MAX_MESSAGES = 100;
const users = new Map();

function displayName(user, ansn) {
  if (ansn === false || ansn === 'false' || ansn === undefined || ansn === null) {
    return user;
  }

  return user + ' (ansn)';
}

function rememberUser(user, ansn) {
  const key = String(user).trim();

  if (!key || key === 'roblox_player') {
    return;
  }

  const prev = users.get(key) || {};

  users.set(key, {
    user: key,
    ansn: Boolean(ansn),
    seen: Date.now(),
    lastSeen: Date.now(),
    messages: Number(prev.messages || 0)
  });
}

function userSnapshot() {
  return Array.from(users.values()).map((item) => ({
    user: item.user,
    ansn: item.ansn,
    display: displayName(item.user, item.ansn),
    seen: new Date(item.seen).toISOString(),
    lastSeen: new Date(item.lastSeen).toISOString(),
    messages: item.messages
  }));
}

function pushMessage(data) {
  messages.push({
    id: Date.now() + '_' + Math.random().toString(36).slice(2),
    ...data,
    time: new Date().toISOString()
  });

  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const enableIrc = String(env.ENABLE_IRC || 'true').toLowerCase() !== 'false';
    const ircHost = env.IRC_HOST || 'irc.libera.chat';
    const ircChannels = (env.IRC_CHANNELS || '#general,#random').split(',');

    // 健康检查
    if (url.pathname === '/' || url.pathname === '/api/irc/status') {
      return Response.json({
        ok: true,
        service: 'roblox-irc-api',
        ircEnabled: enableIrc,
        messageCount: messages.length,
        userCount: users.size,
        channels: ircChannels
      });
    }

    // 拉取最近消息
    if (url.pathname === '/api/irc/messages' && request.method === 'GET') {
      return Response.json({
        ok: true,
        messages: messages.slice(-50)
      });
    }

    // 玩家加入检测
    if (url.pathname === '/api/irc/join' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
      }

      const user = String(body.user || body.name || 'roblox_player').trim();
      const ansn = body.ansn === true || body.ansn === 'true';

      if (!user || user === 'roblox_player') {
        return Response.json({ ok: false, error: 'user is required' }, { status: 400 });
      }

      rememberUser(user, ansn);

      return Response.json({
        ok: true,
        user: user,
        ansn,
        display: displayName(user, ansn),
        users: userSnapshot()
      });
    }

    // 玩家离开
    if (url.pathname === '/api/irc/leave' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
      }

      const user = String(body.user || body.name || '').trim();

      if (user) {
        users.delete(user);
      }

      return Response.json({
        ok: true,
        user: user,
        users: userSnapshot()
      });
    }

    // 查询谁使用过 / 谁是 ansn
    if (url.pathname === '/api/irc/ansn' && request.method === 'GET') {
      return Response.json({
        ok: true,
        users: userSnapshot(),
        ansnUsers: userSnapshot().filter((item) => item.ansn)
      });
    }

    // 查询所有已知用户
    if (url.pathname === '/api/irc/users' && request.method === 'GET') {
      return Response.json({
        ok: true,
        users: userSnapshot()
      });
    }

    // 发送消息
    if (url.pathname === '/api/irc/send' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
      }

      const channel = body.channel || ircChannels[0];
      const user = String(body.user || 'roblox_player').trim();
      const text = String(body.message || '').trim();

      if (!text) {
        return Response.json({ ok: false, error: 'message is required' }, { status: 400 });
      }

      const record = {
        channel,
        user,
        text,
        time: new Date().toISOString(),
        local: true,
        ircEnabled: enableIrc
      };

      // 真实连 IRC：Workers 不能直接开 TCP，要接真实 IRC 需要你在控制台配 External Service
      // 这里先只写进本地缓存，方便 Roblox 先跑通
      pushMessage(record);

      return Response.json({
        ok: true,
        message: record
      });
    }

    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  }
};
