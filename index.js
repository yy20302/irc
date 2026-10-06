const path = require('path');

// 部署平台通常只需要运行 npm start，实际逻辑统一放在 server.js。
// 这里保留入口文件，方便 Render / Railway / Vercel 使用 index.js 作为启动入口。
require(path.join(__dirname, 'server.js'));
