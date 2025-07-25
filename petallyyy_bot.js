// Migrate from node-telegram-bot-api to telegraf
const { Telegraf } = require('telegraf');
const { spawn } = require('child_process');

require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set in environment variables. Exiting.');
    process.exit(1);
}

const bot = new Telegraf(token);

// Store chat history and pet details for each user
const userSessions = {}; // userId: { chatHistory: [], petDetails: {} }

// Basic rate limiting: 1 message per 1 second per user
const lastMessageTime = {};
const RATE_LIMIT_DELAY = 1000; // 1 second in milliseconds

// Function to get response from chatbot.py
async function getChatbotResponse(userId, messageText) {
    if (!userSessions[userId]) {
        userSessions[userId] = { chatHistory: [], petDetails: {} };
    }

    const { chatHistory, petDetails } = userSessions[userId];

    // Add user's message to chat history
    chatHistory.push({ role: 'user', parts: [{ text: messageText }] });

    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', ['chatbot.py']);

        let responseData = '';
        let errorData = '';

        pythonProcess.stdout.on('data', (data) => {
            responseData += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorData += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`Chatbot process exited with code ${code}. Stderr: ${errorData}`);
                reject(new Error(`Chatbot process exited with an error. Please check the bot's logs for details.`));
                return;
            }

            try {
                const result = JSON.parse(responseData);
                if (result.error) {
                    console.error(`Error from chatbot.py: ${result.error}`);
                    reject(new Error(`Chatbot returned an error: ${result.error}. Please try again.`));
                } else {
                    // Add bot's response to chat history
                    chatHistory.push({ role: 'model', parts: [{ text: result.response }] });
                    resolve(result.response);
                }
            } catch (e) {
                console.error(`Failed to parse JSON from chatbot.py: ${e}. Raw response: ${responseData}`);
                reject(new Error(`Received an unreadable response from the chatbot. Please try again.`));
            }
        });

        // Send data to chatbot.py via stdin
        pythonProcess.stdin.write(JSON.stringify({
            pet_details: petDetails,
            chat_history: chatHistory
        }));
        pythonProcess.stdin.end();
    });
}

// Telegraf message handler
bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const messageText = ctx.message.text;

    // Implement rate limiting
    const now = Date.now();
    if (lastMessageTime[userId] && (now - lastMessageTime[userId] < RATE_LIMIT_DELAY)) {
        await ctx.reply('Please wait a moment before sending another message.');
        return;
    }
    lastMessageTime[userId] = now;

    if (!messageText) {
        await ctx.reply('Please send a text message.');
        return;
    }

    // Improved /setpet command parsing (allow spaces in name and breed)
    if (messageText.startsWith('/setpet')) {
        // Usage: /setpet "Pet Name" <type> <age> "Pet Breed"
        const petRegex = /^\/setpet\s+"([^"]+)"\s+(Dog|Cat)\s+(\d{1,2})\s+"([^"]+)"$/i;
        const match = messageText.match(petRegex);
        if (match) {
            const [, pet_name, pet_type, pet_age, pet_breed] = match;
            if (!['Dog', 'Cat'].includes(pet_type)) {
                await ctx.reply('Pet type must be Dog or Cat.');
                return;
            }
            if (isNaN(Number(pet_age)) || Number(pet_age) < 0) {
                await ctx.reply('Pet age must be a valid non-negative number.');
                return;
            }
            userSessions[userId] = userSessions[userId] || { chatHistory: [], petDetails: {} };
            userSessions[userId].petDetails = {
                pet_name,
                pet_type,
                pet_age,
                pet_breed
            };
            await ctx.reply(`Pet details set: Name=${pet_name}, Type=${pet_type}, Age=${pet_age}, Breed=${pet_breed}`);
        } else {
            await ctx.reply('Usage: /setpet "<name>" <Dog|Cat> <age> "<breed>"\nExample: /setpet "Tommy" Dog 5 "Golden Retriever"');
        }
        return;
    }

    // Handle /start command
    if (messageText === '/start') {
        if (!userSessions[userId]) {
            userSessions[userId] = { chatHistory: [], petDetails: {} };
        }
        await ctx.reply('Welcome to Petallyyy Bot!\nPlease tell me about your pet\'s issue.\nYou can set your pet details using:\n/setpet "<name>" <Dog|Cat> <age> "<breed>"\nExample: /setpet "Tommy" Dog 5 "Golden Retriever"');
        return;
    }

    try {
        const response = await getChatbotResponse(userId, messageText);
        await ctx.reply(response);
    } catch (error) {
        console.error('Error sending message to chatbot:', error);
        await ctx.reply('Sorry, something went wrong while processing your request. Please try again later.');
    }
});

// Global error handling
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

bot.launch();
console.log('Petallyyy Telegram Bot (Telegraf) is running...');

