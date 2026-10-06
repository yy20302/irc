-- Roblox 端示例：把这段脚本放到 LocalScript 里。
-- 本地测试：先把 server.js 启动，API 地址通常是 http://localhost:3000
-- 正式发布：填你的公网 HTTPS 地址，例如 https://api.yourdomain.com

local HttpService = game:GetService("HttpService")

local API_BASE = "http://localhost:3000"
local channel = "#general"
local playerName = "RobloxPlayer1"

local function sendToIRC(message)
    local body = HttpService:JSONEncode({
        channel = channel,
        user = playerName,
        message = message,
    })

    local response = HttpService:PostAsync(
        API_BASE .. "/api/irc/send",
        body,
        Enum.HttpContentType.ApplicationJson
    )

    local result = HttpService:JSONDecode(response)
    print("Roblox IRC send result:", result)
end

local function pollMessages()
    local response = HttpService:GetAsync(API_BASE .. "/api/irc/messages")
    local result = HttpService:JSONDecode(response)

    for _, item in ipairs(result.messages or {}) do
        print(item.channel, item.user, item.text, item.time)
    end
end

-- 发送一条消息到 IRC
sendToIRC("你好，这是来自 Roblox 的消息")

-- 定时拉取频道消息
while true do
    task.wait(5)
    pollMessages()
end
