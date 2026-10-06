// 这是 Roblox -> Cloudflare Worker -> IRC 中转的最小版 API
// 先不接真实 IRC，只负责 Roblox 和消息缓存
const messages = [];
const MAX_MESSAGES = 100;

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
    const ircChannels = (env.IRC_CHANNELS || '#general,#random').split(',');

    if (url.pathname === '/' || url.pathname === '/api/irc/status') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'roblox-irc-api',
        ircEnabled: enableIrc,
        messageCount: messages.length,
        channels: ircChannels
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    if (url.pathname === '/api/irc/messages' && request.method === 'GET') {
      return new Response(JSON.stringify({
        ok: true,
        messages: messages.slice(-50)
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (url.pathname === '/api/irc/send' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      const channel = body.channel || ircChannels[0];
      const user = String(body.user || 'roblox_player').trim();
      const text = String(body.message || '').trim();

      if (!text) {
        return new Response(JSON.stringify({ ok: false, error: 'message is required' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      const record = {
        channel,
        user,
        text,
        time: new Date().toISOString(),
        local: true,
        ircEnabled: enableIrc
      };

      pushMessage(record);

      return new Response(JSON.stringify({
        ok: true,
        message: record
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    return new Response(JSON.stringify({ ok: false, error: 'not found' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
