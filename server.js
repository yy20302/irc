const express = require('express');

// 先声明 IRC 客户端对象；连接逻辑放到环境变量判断里，方便部署后先测试 HTTP API。
let ircClient = null;
let ircModule = null;

const app = express();
const port = process.env.PORT || 3000;

// Roblox 通过 HTTPS 访问你的后端
app.use(express.json());
app.use(function (req, res, next) {
  // 允许 Roblox Studio / Roblox 客户端访问，不做额外鉴权
  next();
});

// 配置 IRC 服务器
const ircHost = process.env.IRC_HOST || 'irc.libera.chat';
const ircPort = Number(process.env.IRC_PORT || 6697);
const ircNick = process.env.IRC_NICK || 'roblox_bot_' + Math.random().toString(36).slice(2, 8);
const ircChannels = (process.env.IRC_CHANNELS || '#general,#random')
  .split(',')
  .filter((item) => item.length > 0);
const enableIrc = String(process.env.ENABLE_IRC || 'true').toLowerCase() !== 'false';

// 存最近消息，供 Roblox 拉取
const messageStore = {
  channel: [],
  max: 100
};

function pushMessage(data) {
  messageStore.channel.push({
    id: Date.now() + '_' + Math.random().toString(36).slice(2),
    ...data,
    time: new Date().toISOString()
  });

  if (messageStore.channel.length > messageStore.max) {
    messageStore.channel.shift();
  }
}

function sendIrcMessage(channel, user, message) {
  const ircText = '[Roblox ' + user + '] ' + message;

  if (enableIrc && ircClient) {
    ircClient.say(channel, ircText, function () {
      pushMessage({
        channel,
        user: user,
        text: message,
        local: true
      });
    });
    return;
  }

  // 未连接真实 IRC 时，至少把消息写进本地缓存，方便 Roblox 测试
  pushMessage({
    channel,
    user: user,
    text: ircText,
    local: true
  });
}

function connectIrc() {
  try {
    ircModule = require('irc');
  } catch (error) {
    console.error('Failed to load irc module:', error.message);
    return;
  }

  ircClient = new ircModule.Client(ircHost, ircNick, {
    port: ircPort,
    secure: true,
    channels: ircChannels,
    autoRejoin: false,
    floodProtection: true,
    floodProtectionDelay: 500
  });

  ircClient.on('message', function (from, channel, message) {
    pushMessage({
      channel,
      user: from,
      text: message,
      local: false
    });
  });

  ircClient.on('error', function (error) {
    console.error('IRC connection error:', error.message || error);
  });

  ircClient.on('register', function () {
    console.log('IRC registered as ' + ircNick);
  });

  ircClient.connect();
  console.log('IRC target: ' + ircHost + ':' + ircPort + ' ' + ircChannels.join(', '));
}

if (enableIrc) {
  connectIrc();
} else {
  console.log('ENABLE_IRC=false; running without a live IRC connection.');
}

// 部署平台健康检查
app.get('/', function (req, res) {
  res.json({
    ok: true,
    service: 'roblox-irc-api',
    ircEnabled: enableIrc,
    ircConnected: Boolean(ircClient),
  });
});

// 获取频道最近消息
app.get('/api/irc/messages', function (req, res) {
  res.json({
    ok: true,
    messages: messageStore.channel.slice(-50)
  });
});

// Roblox 发送消息到 IRC
app.post('/api/irc/send', function (req, res) {
  const channel = req.body.channel || ircChannels[0];
  const message = String(req.body.message || '').trim();
  const user = String(req.body.user || 'roblox_player').trim();

  if (!message) {
    res.status(400).json({ ok: false, error: 'message is required' });
    return;
  }

  sendIrcMessage(channel, user, message);

  res.json({
    ok: true,
    message: {
      channel,
      user,
      text: message,
      time: new Date().toISOString(),
      ircEnabled: enableIrc
    }
  });
});

// 获取当前配置，方便调试
app.get('/api/irc/status', function (req, res) {
  res.json({
    ok: true,
    ircHost,
    ircPort,
    ircNick,
    channels: ircChannels,
    ircEnabled: enableIrc,
    ircConnected: Boolean(ircClient),
    messageCount: messageStore.channel.length
  });
});

app.listen(port, function () {
  console.log('Roblox IRC API listening on http://localhost:' + port);
});
