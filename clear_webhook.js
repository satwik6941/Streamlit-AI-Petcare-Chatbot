// Clear webhook script - run this if you have webhook conflicts
const { Telegraf } = require('telegraf');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set in environment variables.');
    process.exit(1);
}

const bot = new Telegraf(token);

async function clearWebhook() {
    try {
        console.log('Clearing webhook...');
        await bot.telegram.deleteWebhook();
        console.log('✅ Webhook cleared successfully!');
        
        // Check current webhook info
        const webhookInfo = await bot.telegram.getWebhookInfo();
        console.log('Current webhook info:', webhookInfo);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error clearing webhook:', error);
        process.exit(1);
    }
}

clearWebhook();
