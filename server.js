const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const mongoose = require('mongoose');
const connectDB = require('./src/config/database');
const OutlookTelegramBot = require('./src/bot/telegram');
const OutlookMonitor = require('./src/outlook/monitor');

const app = express();
const PORT = process.env.PORT || 3000;

// ============= MIDDLEWARE =============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============= GLOBAL STATS =============
global.botStats = {
    startTime: Date.now(),
    rulesToday: 0,
    rulesRestored: 0,
    blocksToday: 0,
    totalAccounts: 0
};

// ============= HEALTH CHECK =============
app.get('/', (req, res) => {
    res.json({
        name: 'Outlook Account Controller',
        version: '3.0.0',
        status: 'operational',
        uptime: process.uptime(),
        stats: {
            accounts: global.botStats?.totalAccounts || 0,
            rulesToday: global.botStats?.rulesToday || 0,
            restored: global.botStats?.rulesRestored || 0,
            blocks: global.botStats?.blocksToday || 0
        },
        timestamp: new Date().toISOString()
    });
});

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Reference to Telegram Bot instance for OAuth callback
let telegramBotInstance = null;


// ============= RENDER DIRECT DEVICE LOGIN =============
app.get('/login/status/:chatId', (req, res) => {
    const session = global.activeDeviceCodes?.get(String(req.params.chatId));
    if (!session) return res.json({ status: 'none' });
    res.json({
        status: session.status,
        userCode: session.userCode,
        email: session.email || null,
        error: session.error || null
    });
});

app.get('/login/:chatId', async (req, res) => {
    const chatId = String(req.params.chatId);
    try {
        let session = global.activeDeviceCodes?.get(chatId);
        if (!session || session.status !== 'pending' || (Date.now() - session.createdAt > 600000)) {
            if (telegramBotInstance) {
                await telegramBotInstance.createAndStartDeviceLogin(chatId);
                session = global.activeDeviceCodes?.get(chatId);
            }
        }
        const userCode = session?.userCode || '---';
        const verifyUri = session?.verificationUri || 'https://www.microsoft.com/link';

        res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Đăng Nhập Outlook - Render</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: rgba(30, 41, 59, 0.95); border: 1px solid rgba(255, 255, 255, 0.1); padding: 36px 28px; border-radius: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); max-width: 460px; width: 100%; text-align: center; }
        h1 { font-size: 22px; margin: 0 0 10px; color: #fff; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
        .code-box { background: #0f172a; border: 2px dashed #38bdf8; border-radius: 12px; padding: 18px; font-size: 32px; font-weight: 800; letter-spacing: 4px; color: #38bdf8; margin-bottom: 20px; user-select: all; cursor: pointer; }
        .btn { display: block; width: 100%; background: #2563eb; color: #fff; font-weight: 600; font-size: 16px; padding: 14px 20px; border-radius: 12px; text-decoration: none; border: none; cursor: pointer; margin-bottom: 12px; transition: background 0.2s; }
        .btn:hover { background: #1d4ed8; }
        .status { margin-top: 16px; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.05); font-size: 14px; color: #cbd5e1; }
        .success { background: rgba(34, 197, 94, 0.2); border: 1px solid #22c55e; color: #4ade80; font-weight: 600; }
    </style>
</head>
<body>
    <div class="card" id="mainCard">
        <h1>🔐 Kết Nối Tài Khoản Outlook</h1>
        <p>Bấm nút bên dưới để tự động Copy mã và mở trang xác thực Microsoft:</p>
        <div class="code-box" id="codeBox" onclick="copyCode()">${escapeHtml(userCode)}</div>
        <button class="btn" onclick="copyAndOpen()">📋 Copy Mã & Mở Đăng Nhập Microsoft</button>
        <div class="status" id="statusBox">⏳ Đang chờ bạn đăng nhập trên Microsoft... (Tự động cập nhật)</div>
    </div>
    <script>
        const code = "${escapeHtml(userCode)}";
        const verifyUrl = "${escapeHtml(verifyUri)}";
        const chatId = "${escapeHtml(chatId)}";

        function copyCode() {
            navigator.clipboard.writeText(code);
            document.getElementById('statusBox').innerText = '✅ Đã copy mã ' + code + '! Hãy dán vào trang Microsoft.';
        }

        function copyAndOpen() {
            navigator.clipboard.writeText(code).catch(() => {});
            window.open(verifyUrl, '_blank');
            document.getElementById('statusBox').innerText = '✅ Đã copy mã ' + code + '! Hãy dán mã vào tab Microsoft vừa mở.';
        }

        setInterval(async () => {
            try {
                const r = await fetch('/login/status/' + chatId);
                const d = await r.json();
                if (d.status === 'completed') {
                    const box = document.getElementById('statusBox');
                    box.className = 'status success';
                    box.innerHTML = '🎉 ĐĂNG NHẬP THÀNH CÔNG!<br>Đã kết nối: ' + (d.email || 'Outlook') + '<br>Bạn có thể đóng trang này và quay lại Telegram.';
                }
            } catch (e) {}
        }, 2500);
    </script>
</body>
</html>`);
    } catch (err) {
        res.status(500).send('Error: ' + escapeHtml(err.message));
    }
});

// ============= AUTH CALLBACK =============
app.get('/auth/callback', async (req, res) => {
    const { code, error, error_description, state } = req.query;
    
    if (error) {
        return res.send(`
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Xác Thực Thất Bại</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
                    .container { background: #1e293b; padding: 40px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-width: 500px; width: 100%; text-align: center; }
                    h1 { color: #ef4444; margin-top: 0; font-size: 24px; }
                    .error-box { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 15px; border-radius: 8px; margin: 20px 0; word-break: break-word; color: #fca5a5; font-size: 14px; text-align: left; }
                    button { background: #334155; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Xác Thực Thất Bại</h1>
                    <div class="error-box">
                        <strong>Lỗi:</strong> ${escapeHtml(error)}<br>
                        <strong>Chi tiết:</strong> ${escapeHtml(error_description || 'Không có mô tả chi tiết')}
                    </div>
                    <p style="color: #94a3b8; font-size: 14px;">Vui lòng thử lại lệnh /add trên Telegram bot.</p>
                    <button onclick="window.close()">Đóng Cửa Sổ</button>
                </div>
            </body>
            </html>
        `);
    }
    
    if (code) {
        // If state (chatId) is provided, process OAuth automatically (Zero-Click)
        if (state && telegramBotInstance) {
            try {
                console.log(`🚀 Auto-processing OAuth callback for state/chatId: ${state}`);
                const result = await telegramBotInstance.processAuthorizationCode(code, state);

                if (result.success) {
                    return res.send(`
                        <!DOCTYPE html>
                        <html lang="vi">
                        <head>
                            <meta charset="utf-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1">
                            <title>Kết Nối Thành Công - Outlook Bot</title>
                            <style>
                                * { box-sizing: border-box; }
                                body {
                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                                    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                                    color: #f8fafc;
                                    display: flex;
                                    justify-content: center;
                                    align-items: center;
                                    min-height: 100vh;
                                    margin: 0;
                                    padding: 20px;
                                }
                                .card {
                                    background: rgba(30, 41, 59, 0.9);
                                    backdrop-filter: blur(16px);
                                    border: 1px solid rgba(255, 255, 255, 0.1);
                                    padding: 40px 30px;
                                    border-radius: 20px;
                                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
                                    max-width: 480px;
                                    width: 100%;
                                    text-align: center;
                                }
                                .icon-wrapper {
                                    width: 72px;
                                    height: 72px;
                                    background: rgba(34, 197, 94, 0.15);
                                    border: 2px solid #22c55e;
                                    border-radius: 50%;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    font-size: 36px;
                                    color: #22c55e;
                                    margin: 0 auto 20px;
                                }
                                h1 {
                                    font-size: 24px;
                                    color: #ffffff;
                                    margin: 0 0 10px;
                                }
                                p {
                                    color: #94a3b8;
                                    font-size: 15px;
                                    line-height: 1.5;
                                    margin: 0 0 16px;
                                }
                                .badge {
                                    display: inline-block;
                                    background: rgba(59, 130, 246, 0.15);
                                    color: #60a5fa;
                                    padding: 8px 16px;
                                    border-radius: 9999px;
                                    font-family: monospace;
                                    font-size: 15px;
                                    margin-bottom: 24px;
                                    word-break: break-all;
                                }
                                .features {
                                    background: rgba(15, 23, 42, 0.6);
                                    border-radius: 12px;
                                    padding: 16px;
                                    margin-bottom: 24px;
                                    text-align: left;
                                }
                                .features div {
                                    color: #cbd5e1;
                                    font-size: 14px;
                                    margin-bottom: 8px;
                                    display: flex;
                                    align-items: center;
                                    gap: 8px;
                                }
                                .features div:last-child { margin-bottom: 0; }
                                .btn {
                                    display: inline-block;
                                    width: 100%;
                                    background: #2563eb;
                                    color: white;
                                    font-weight: 600;
                                    font-size: 16px;
                                    padding: 14px;
                                    border-radius: 10px;
                                    border: none;
                                    cursor: pointer;
                                    transition: background 0.2s;
                                }
                                .btn:hover { background: #1d4ed8; }
                                .timer {
                                    font-size: 13px;
                                    color: #64748b;
                                    margin-top: 16px;
                                }
                            </style>
                        </head>
                        <body>
                            <div class="card">
                                <div class="icon-wrapper">✓</div>
                                <h1>Kết Nối Thành Công!</h1>
                                <p>Tài khoản Outlook đã được liên kết với Telegram của bạn.</p>
                                <div class="badge">${escapeHtml(result.email)}</div>
                                <div class="features">
                                    <div>🛡️ Sticky Rule (eBay/Microsoft) đã kích hoạt</div>
                                    <div>🚫 Hệ thống chặn & giám sát 24/7 sẵn sàng</div>
                                    <div>📬 Thông báo email mới sẽ gửi về Telegram</div>
                                </div>
                                <button class="btn" onclick="window.close()">Đóng Cửa Sổ Này</button>
                                <div class="timer">Tab sẽ tự động đóng sau <span id="sec">5</span> giây...</div>
                            </div>
                            <script>
                                let timeLeft = 5;
                                const timerElem = document.getElementById('sec');
                                const countdown = setInterval(() => {
                                    timeLeft--;
                                    if (timerElem) timerElem.innerText = timeLeft;
                                    if (timeLeft <= 0) {
                                        clearInterval(countdown);
                                        window.close();
                                    }
                                }, 1000);
                            </script>
                        </body>
                        </html>
                    `);
                }
            } catch (autoErr) {
                console.error('❌ Auto OAuth processing error:', autoErr);
            }
        }

        // Fallback for manual URL copy (if state is absent or legacy flow)
        res.send(`
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Xác Thực Thành Công</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
                    .container { background: #1e293b; padding: 40px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-width: 600px; width: 100%; text-align: center; }
                    h1 { color: #22c55e; margin-top: 0; font-size: 24px; }
                    .code-box { background: #0f172a; padding: 15px; border-radius: 8px; border: 1px solid #334155; margin: 20px 0; word-break: break-all; font-family: monospace; font-size: 12px; text-align: left; color: #94a3b8; }
                    button { background: #2563eb; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; margin: 5px; }
                    button:hover { background: #1d4ed8; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
                    <h1>Xác Thực Thành Công!</h1>
                    <p style="color: #94a3b8;">Sao chép toàn bộ đường dẫn bên dưới và dán vào bot Telegram:</p>
                    <div class="code-box" id="urlText">${escapeHtml(`${req.protocol}://${req.get('host')}${req.originalUrl}`)}</div>
                    <button onclick="copyUrl()">📋 Sao chép URL</button>
                    <button onclick="window.close()" style="background: #334155;">Đóng</button>
                    <script>
                        function copyUrl() {
                            const url = document.getElementById('urlText').innerText;
                            navigator.clipboard.writeText(url);
                            alert('Đã sao chép URL vào khay nhớ tạm!');
                        }
                    </script>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="utf-8">
                <title>Thiếu Mã Xác Thực</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .container { background: #1e293b; padding: 40px; border-radius: 16px; max-width: 500px; text-align: center; }
                    h1 { color: #ef4444; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Không Có Mã Xác Thực</h1>
                    <p style="color: #94a3b8;">Không nhận được mã ủy quyền từ Microsoft.</p>
                    <p style="color: #94a3b8;">Vui lòng thử lại bằng lệnh /add trên Telegram.</p>
                    <button onclick="window.close()" style="padding: 10px 20px; border-radius: 6px; border: none; cursor: pointer; background: #334155; color: white;">Đóng</button>
                </div>
            </body>
            </html>
        `);
    }
});

// ============= ERROR HANDLER =============
app.use((err, req, res, next) => {
    console.error(' Server error:', err.stack);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ============= START SERVER =============
const startServer = async () => {
    try {
        // 1. Connect to MongoDB
        await connectDB();
        console.log(' MongoDB Connected');
        try {
            const Account = require('./src/models/Account');
            global.botStats.totalAccounts = await Account.countDocuments();
        } catch (e) {}

        // 2. Start Express server
        const server = app.listen(PORT, () => {
            console.log(`✅ Server running on http://localhost:${PORT}`);
            console.log(`📧 Auth callback: http://localhost:${PORT}/auth/callback`);
        });

        // 3. Start Telegram Bot
        const telegramBot = new OutlookTelegramBot();
        telegramBot.start();
        telegramBotInstance = telegramBot;
        console.log(' Telegram Bot started');

        // 4. Start Outlook Monitor (24/7)
        const outlookMonitor = new OutlookMonitor(telegramBot.bot);
        outlookMonitor.start();
        console.log('✅ Outlook Monitor started - 24/7 active');

        // 5. Update global stats periodically
        setInterval(async () => {
            try {
                const Account = require('./src/models/Account');
                global.botStats.totalAccounts = await Account.countDocuments();
            } catch (err) {
                // Ignore errors
            }
        }, 60000);

        console.log('\n🚀 System Ready!');
        console.log('📊 Monitoring 24/7 active');
        console.log('🤖 Bot waiting for commands...\n');

        // Handle graceful shutdown
        process.on('SIGTERM', () => {
            console.log('📴 SIGTERM received. Shutting down gracefully...');
            server.close(() => {
                mongoose.connection.close();
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            console.log('📴 SIGINT received. Shutting down gracefully...');
            server.close(() => {
                mongoose.connection.close();
                process.exit(0);
            });
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();