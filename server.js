// server.js
require('dotenv').config();
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

// ============= AUTH CALLBACK =============
app.get('/auth/callback', (req, res) => {
    const { code, error, error_description } = req.query;
    
    if (error) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Authentication Failed</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); max-width: 600px; }
                    h1 { color: #dc3545; margin-top: 0; }
                    .error-box { background: #f8d7da; padding: 15px; border-radius: 5px; border: 1px solid #f5c6cb; margin: 20px 0; word-break: break-word; }
                    button { background: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Authentication Failed</h1>
                    <div class="error-box">
                        <strong>Error:</strong> ${error}<br>
                        <strong>Description:</strong> ${error_description || 'No description'}
                    </div>
                    <p>Please copy this error and send to Telegram bot.</p>
                    <button onclick="window.close()">Close</button>
                </div>
            </body>
            </html>
        `);
    }
    
    if (code) {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Authentication Successful</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); max-width: 800px; text-align: center; }
                    h1 { color: #28a745; margin-top: 0; }
                    .success-icon { color: #28a745; font-size: 64px; margin-bottom: 20px; }
                    .code-box { background: #f8f9fa; padding: 20px; border-radius: 5px; border: 1px solid #dee2e6; margin: 20px 0; word-break: break-all; font-family: monospace; font-size: 12px; text-align: left; }
                    button { background: #007bff; color: white; border: none; padding: 12px 30px; border-radius: 5px; cursor: pointer; font-size: 16px; margin: 5px; }
                    button:hover { background: #0056b3; }
                    .note { color: #6c757d; margin-top: 20px; font-size: 14px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="success-icon">✅</div>
                    <h1>Authentication Successful!</h1>
                    <p>Your Outlook account has been authorized.</p>
                    <p style="color: #6c757d;">Copy the FULL URL below and send it to the Telegram bot:</p>
                    <div class="code-box" id="urlText">${req.protocol}://${req.get('host')}${req.originalUrl}</div>
                    <button onclick="copyUrl()">📋 Copy URL</button>
                    <button onclick="window.close()">✖ Close</button>
                    <p class="note">Return to Telegram bot and paste the URL to complete connection.</p>
                    <script>
                        function copyUrl() {
                            const url = document.getElementById('urlText').innerText;
                            navigator.clipboard.writeText(url);
                            alert('✅ URL copied to clipboard!');
                        }
                    </script>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); max-width: 600px; text-align: center; }
                    h1 { color: #dc3545; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ No Authorization Code</h1>
                    <p>No authorization code was received from Microsoft.</p>
                    <p>Please try again using /add command in Telegram.</p>
                    <button onclick="window.close()" style="padding: 10px 20px; margin-top: 20px;">Close</button>
                </div>
            </body>
            </html>
        `);
    }
});

// ============= ERROR HANDLER =============
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err.stack);
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
        console.log('✅ MongoDB Connected');

        // 2. Start Express server
        const server = app.listen(PORT, () => {
            console.log(`✅ Server running on http://localhost:${PORT}`);
            console.log(`📧 Auth callback: http://localhost:${PORT}/auth/callback`);
        });

        // 3. Start Telegram Bot
        const telegramBot = new OutlookTelegramBot();
        telegramBot.start();
        console.log('✅ Telegram Bot started');

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