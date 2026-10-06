$ErrorActionPreference = "Stop"

$RepoName = if ($args.Count -ge 1) { $args[0] } else { "roblox-irc-api" }

Write-Host "==> 初始化 git 仓库" -ForegroundColor Cyan
if (-not (Test-Path .git)) {
    git init
}

git add .
git commit -m "deploy: Roblox IRC API"

if ([string]::IsNullOrWhiteSpace((git remote | Out-String))) {
    Write-Host "请先在 GitHub 创建仓库，然后设置 remote。" -ForegroundColor Yellow
    Write-Host "你可以先执行:" -ForegroundColor Yellow
    Write-Host "  git remote add origin git@github.com:你的用户名/${RepoName}.git" -ForegroundColor Yellow
    exit 1
}

git push

Write-Host ""
Write-Host "==> 代码已推送到 GitHub" -ForegroundColor Green
Write-Host ""
Write-Host "接下来到 Render 部署:" -ForegroundColor Cyan
Write-Host "1. New + -> Web Service"
Write-Host "2. 连接你的 GitHub 仓库"
Write-Host "3. Build Command: npm install"
Write-Host "4. Start Command: npm start"
Write-Host "5. 环境变量先设 ENABLE_IRC=false"
Write-Host "6. 部署后访问 https://你的服务名.onrender.com/"
