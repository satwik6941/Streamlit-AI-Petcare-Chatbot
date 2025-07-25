// Migrate from node-telegram-bot-api to telegraf
const { Telegraf } = require('telegraf');
const { spawn } = require('child_process');
const express = require('express');

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

// List of greeting keywords
const GREETINGS = ['hi', 'hello', '/start', 'hey', 'greetings'];

// Reset command to restart conversation
const RESET_COMMANDS = ['/reset', '/restart', '/newpet'];

// Debug command to check session
const DEBUG_COMMANDS = ['/debug', '/status', '/check'];

// Pet detail prompts with button configurations
const PET_DETAIL_FIELDS = [
    { key: 'pet_name', prompt: 'What is your pet\'s name?', type: 'text' },
    { key: 'pet_type', prompt: 'What type of pet do you have?', type: 'buttons', options: ['Dog', 'Cat', 'Bird', 'Other'] },
    { key: 'pet_gender', prompt: 'What is your pet\'s gender?', type: 'buttons', options: ['Male', 'Female', 'Unknown'] },
    { key: 'pet_age', prompt: 'How old is your pet? (e.g., "2 years", "6 months")', type: 'text' },
    { key: 'pet_breed', prompt: 'What is your pet\'s breed?', type: 'text' },
    { key: 'pet_weight', prompt: 'What is your pet\'s weight? (Please include unit like kg or lbs)', type: 'text' }
];

// Helper to check if message is a greeting
function isGreeting(text) {
    if (!text) return false;
    return GREETINGS.some(g => text.trim().toLowerCase() === g);
}

// Helper to check if message is a reset command
function isResetCommand(text) {
    if (!text) return false;
    return RESET_COMMANDS.some(r => text.trim().toLowerCase() === r);
}

// Helper to check if message is a debug command
function isDebugCommand(text) {
    if (!text) return false;
    return DEBUG_COMMANDS.some(d => text.trim().toLowerCase() === d);
}

// Helper to get next missing pet detail
function getNextPetDetail(petDetails) {
    for (const field of PET_DETAIL_FIELDS) {
        if (!petDetails[field.key]) return field;
    }
    return null;
}

// Helper to extract file info from Telegraf message
async function extractFiles(ctx) {
    const files = [];
    
    try {
        // Handle photos
        if (ctx.message.photo) {
            // Get the highest resolution photo
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const fileLink = await ctx.telegram.getFileLink(photo.file_id);
            files.push({
                type: 'image',
                file_id: photo.file_id,
                file_link: fileLink.href,
                file_unique_id: photo.file_unique_id,
                file_name: `photo_${photo.file_id}.jpg`
            });
        }
        
        // Handle documents (PDFs, images, videos, etc.)
        if (ctx.message.document) {
            const doc = ctx.message.document;
            const fileLink = await ctx.telegram.getFileLink(doc.file_id);
            files.push({
                type: doc.mime_type && doc.mime_type.startsWith('image/') ? 'image' : doc.mime_type || 'document',
                file_id: doc.file_id,
                file_link: fileLink.href,
                file_name: doc.file_name || `document_${doc.file_id}`,
                mime_type: doc.mime_type || 'application/octet-stream',
                file_size: doc.file_size
            });
        }
        
        // Handle videos
        if (ctx.message.video) {
            const video = ctx.message.video;
            const fileLink = await ctx.telegram.getFileLink(video.file_id);
            files.push({
                type: 'video',
                file_id: video.file_id,
                file_link: fileLink.href,
                mime_type: video.mime_type || 'video/mp4',
                file_name: `video_${video.file_id}.mp4`,
                duration: video.duration,
                width: video.width,
                height: video.height
            });
        }
        
        // Handle audio
        if (ctx.message.audio) {
            const audio = ctx.message.audio;
            const fileLink = await ctx.telegram.getFileLink(audio.file_id);
            files.push({
                type: 'audio',
                file_id: audio.file_id,
                file_link: fileLink.href,
                mime_type: audio.mime_type || 'audio/mpeg',
                file_name: audio.file_name || `audio_${audio.file_id}.mp3`,
                duration: audio.duration
            });
        }
        
        // Handle voice messages
        if (ctx.message.voice) {
            const voice = ctx.message.voice;
            const fileLink = await ctx.telegram.getFileLink(voice.file_id);
            files.push({
                type: 'voice',
                file_id: voice.file_id,
                file_link: fileLink.href,
                mime_type: voice.mime_type || 'audio/ogg',
                file_name: `voice_${voice.file_id}.ogg`,
                duration: voice.duration
            });
        }
        
        // Handle stickers as images
        if (ctx.message.sticker) {
            const sticker = ctx.message.sticker;
            const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
            files.push({
                type: 'image',
                file_id: sticker.file_id,
                file_link: fileLink.href,
                file_name: `sticker_${sticker.file_id}.webp`,
                mime_type: 'image/webp'
            });
        }
        
    } catch (error) {
        console.error('Error extracting files:', error);
    }
    
    return files;
}

// Enhanced message handler for all content types including stickers
bot.on(['text', 'photo', 'document', 'video', 'audio', 'voice', 'sticker'], async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const messageText = ctx.message.text || '';
    const files = await extractFiles(ctx);

    // Implement rate limiting
    const now = Date.now();
    if (lastMessageTime[userId] && (now - lastMessageTime[userId] < RATE_LIMIT_DELAY)) {
        await ctx.reply('Please wait a moment before sending another message.');
        return;
    }
    lastMessageTime[userId] = now;

    // Initialize user session if not present
    if (!userSessions[userId]) {
        userSessions[userId] = { 
            chatHistory: [], 
            petDetails: {}, 
            petDetailStep: 0, 
            greeted: false, 
            ready: false,
            questionsAsked: 0, // Track number of clarifying questions asked
            maxQuestions: 4    // Maximum questions allowed
        };
    }
    const session = userSessions[userId];

    // Greeting and pet details collection flow
    if (isGreeting(messageText) && !session.greeted) {
        session.greeted = true;
        session.petDetails = {};
        session.petDetailStep = 0;
        session.ready = false;
        session.questionsAsked = 0;
        session.chatHistory = [];
        await ctx.reply('Hello! I\'m Dr. Paws, your friendly pet care assistant.');
        await sendPetDetailPrompt(ctx, session);
        return;
    }

    // Reset command to start over
    if (isResetCommand(messageText)) {
        session.greeted = false;
        session.petDetails = {};
        session.petDetailStep = 0;
        session.ready = false;
        session.questionsAsked = 0;
        session.chatHistory = [];
        await ctx.reply('Starting fresh! Let\'s begin again.');
        await ctx.reply('Hello! I\'m Dr. Paws, your friendly pet care assistant.');
        await sendPetDetailPrompt(ctx, session);
        return;
    }

    // Debug command to check session status
    if (isDebugCommand(messageText)) {
        const debugInfo = `🔍 **Session Debug Info:**
**User ID:** ${userId}
**Greeted:** ${session.greeted}
**Ready:** ${session.ready}
**Step:** ${session.petDetailStep}/${PET_DETAIL_FIELDS.length}
**Questions Asked:** ${session.questionsAsked}/${session.maxQuestions}

**Pet Details:**
${JSON.stringify(session.petDetails, null, 2)}

**Expected Next Field:** ${PET_DETAIL_FIELDS[session.petDetailStep]?.key || 'All complete'}`;
        
        await ctx.reply(debugInfo, { parse_mode: 'Markdown' });
        return;
    }

    // If not ready, collect pet details step by step
    if (!session.ready) {
        const currentField = PET_DETAIL_FIELDS[session.petDetailStep];
        if (currentField) {
            if (currentField.type === 'text') {
                // Handle text input
                if (messageText && messageText.trim()) {
                    session.petDetails[currentField.key] = messageText.trim();
                    session.petDetailStep++;
                    
                    console.log(`✅ Text input stored: ${currentField.key} = ${messageText.trim()}`);
                    console.log(`📊 Current pet details:`, session.petDetails);
                    
                    await sendPetDetailPrompt(ctx, session);
                    return;
                } else {
                    await ctx.reply('Please provide the information requested above.');
                    return;
                }
            } else if (currentField.type === 'buttons') {
                // For button inputs, ignore text messages and show reminder
                await ctx.reply('Please use the buttons above to make your selection.');
                return;
            }
        }
    }

    // After pet details, start main conversation
    try {
        // Add user message with files to chat history 
        const userParts = [];
        if (messageText && messageText.trim()) {
            userParts.push({ text: messageText.trim() });
        }
        
        // Add file information to user parts
        if (files.length > 0) {
            for (const file of files) {
                userParts.push({ file: file });
                console.log(`Processing file: ${file.type} - ${file.file_link}`);
            }
        }
        
        // Add to chat history if we have content
        if (userParts.length > 0) {
            session.chatHistory.push({ role: 'user', parts: userParts });
        }
        
        // Call chatbot.py with full context including files
        const response = await getChatbotResponse(userId, messageText, files);
        
        // Check for empty response
        if (!response || response.trim() === '') {
            await ctx.reply('I apologize, but I couldn\'t generate a proper response. Please try rephrasing your question or try uploading the image again.');
            return;
        }
        
        await ctx.reply(response, { disable_web_page_preview: true });
    } catch (error) {
        console.error('Error processing request:', error);
        // Send a more specific error message based on the error type
        let errorMessage = 'Sorry, something went wrong. ';
        if (error.message.includes('GEMINI_API_KEY')) {
            errorMessage += 'API key is not configured properly.';
        } else if (error.message.includes('timeout')) {
            errorMessage += 'The request took too long. Please try again.';
        } else if (error.message.includes('Python process')) {
            errorMessage += 'There was an issue with the chatbot service.';
        } else {
            errorMessage += 'Please try again later.';
        }
        await ctx.reply(errorMessage);
    }
});

// Helper to send pet detail prompts with appropriate interface
async function sendPetDetailPrompt(ctx, session) {
    const currentField = PET_DETAIL_FIELDS[session.petDetailStep];
    
    console.log(`Sending prompt for step ${session.petDetailStep}, field: ${currentField?.key || 'none'}`);
    
    if (!currentField) {
        // All details collected - let's verify we have all required data
        const missingFields = [];
        const requiredFields = ['pet_name', 'pet_type', 'pet_gender', 'pet_age', 'pet_breed', 'pet_weight'];
        
        for (const field of requiredFields) {
            if (!session.petDetails[field] || session.petDetails[field].trim() === '') {
                missingFields.push(field);
            }
        }
        
        if (missingFields.length > 0) {
            console.log('❌ Missing fields detected:', missingFields);
            console.log('🔄 Restarting registration from missing field');
            // Find the first missing field and restart from there
            const firstMissingIndex = PET_DETAIL_FIELDS.findIndex(f => missingFields.includes(f.key));
            session.petDetailStep = firstMissingIndex;
            await sendPetDetailPrompt(ctx, session);
            return;
        }
        
        session.ready = true;
        console.log('✅ All pet details collected successfully:', session.petDetails);
        
        // Create comprehensive summary with proper formatting
        const petData = session.petDetails;
        const summary = `🎉 **Pet Registration Complete!**

📝 **Your Pet's Information:**
🐾 **Name:** ${petData.pet_name}
🐕/🐱 **Type:** ${petData.pet_type}
♂️/♀️ **Gender:** ${petData.pet_gender}
📅 **Age:** ${petData.pet_age}
🏷️ **Breed:** ${petData.pet_breed}
⚖️ **Weight:** ${petData.pet_weight}

✅ **Ready for Consultation!**
Hello! I'm Dr. Paws, your veterinary consultant. I'm here to help with any concerns about ${petData.pet_name}.

💡 **What would you like to discuss about ${petData.pet_name} today?**
You can describe symptoms, ask questions, or send photos/videos if needed.`;
        
        await ctx.reply(summary, { parse_mode: 'Markdown' });
        return;
    }

    if (currentField.type === 'text') {
        await ctx.reply(currentField.prompt);
    } else if (currentField.type === 'buttons') {
        const keyboard = {
            inline_keyboard: []
        };
        
        console.log(`Creating buttons for ${currentField.key} with options:`, currentField.options);
        
        // Create single row for all button types
        keyboard.inline_keyboard.push(
            currentField.options.map(option => ({
                text: option,
                callback_data: `${currentField.key}_${option}`
            }))
        );
        
        console.log('Generated keyboard:', JSON.stringify(keyboard, null, 2));
        
        await ctx.reply(currentField.prompt, {
            reply_markup: keyboard
        });
    }
}

// Handle callback queries for button selections
bot.on('callback_query', async (ctx) => {
    const userId = ctx.from.id;
    const data = ctx.callbackQuery.data;
    
    console.log(`Received callback query from user ${userId}: ${data}`);
    
    // Initialize user session if not present
    if (!userSessions[userId]) {
        userSessions[userId] = { 
            chatHistory: [], 
            petDetails: {}, 
            petDetailStep: 0, 
            greeted: false, 
            ready: false,
            questionsAsked: 0,
            maxQuestions: 4
        };
    }
    
    const session = userSessions[userId];
    
    // Parse callback data (format: fieldKey_value)
    // Handle cases where fieldKey contains underscores (like pet_type, pet_gender)
    let fieldKey, selectedValue;
    
    // Check if this matches any of our known field keys
    const knownFieldKeys = PET_DETAIL_FIELDS.map(f => f.key);
    let matchedFieldKey = null;
    
    for (const key of knownFieldKeys) {
        if (data.startsWith(key + '_')) {
            matchedFieldKey = key;
            break;
        }
    }
    
    if (matchedFieldKey) {
        fieldKey = matchedFieldKey;
        selectedValue = data.substring(fieldKey.length + 1); // Get everything after "fieldKey_"
    } else {
        // Fallback to original parsing if no match found
        const [firstPart, ...valueParts] = data.split('_');
        fieldKey = firstPart;
        selectedValue = valueParts.join('_');
    }
    
    console.log(`Parsed: fieldKey=${fieldKey}, selectedValue=${selectedValue}`);
    console.log(`Current session step: ${session.petDetailStep}, Expected field: ${PET_DETAIL_FIELDS[session.petDetailStep]?.key}`);
    console.log(`Raw callback data: ${data}`);
    console.log(`Known field keys: ${knownFieldKeys.join(', ')}`);
    
    try {
        // Verify we're on the correct step for this field
        const expectedField = PET_DETAIL_FIELDS[session.petDetailStep];
        if (!expectedField || expectedField.key !== fieldKey) {
            console.log(`❌ Mismatch: Expected ${expectedField?.key}, got ${fieldKey}`);
            console.log(`📊 Session state - Step: ${session.petDetailStep}, Ready: ${session.ready}, Greeted: ${session.greeted}`);
            
            // If user is somehow out of sync, let them know what step they should be on
            if (expectedField) {
                await ctx.answerCbQuery(`Please complete step ${session.petDetailStep + 1}: ${expectedField.prompt}`);
            } else {
                await ctx.answerCbQuery('Registration appears to be complete. Try /reset to start over.');
            }
            return;
        }
        
        // Store the selected value
        session.petDetails[fieldKey] = selectedValue;
        session.petDetailStep++;
        
        console.log(`✅ Successfully stored ${fieldKey} = ${selectedValue}`);
        console.log(`📊 Current pet details:`, session.petDetails);
        console.log(`➡️ Moving to step ${session.petDetailStep}`);
        
        await ctx.answerCbQuery();
        
        // Find the current field to get the prompt
        const currentField = PET_DETAIL_FIELDS.find(f => f.key === fieldKey);
        if (currentField) {
            await ctx.editMessageText(`${currentField.prompt}\n✅ Selected: ${selectedValue}`);
        }
        
        // Move to next step
        await sendPetDetailPrompt(ctx, session);
    } catch (error) {
        console.error('Error handling callback query:', error);
        await ctx.answerCbQuery('An error occurred. Please try again.');
    }
});
async function getChatbotResponse(userId, messageText, files = []) {
    if (!userSessions[userId]) {
        userSessions[userId] = { 
            chatHistory: [], 
            petDetails: {},
            questionsAsked: 0,
            maxQuestions: 4
        };
    }
    const session = userSessions[userId];
    const { chatHistory, petDetails, questionsAsked, maxQuestions } = session;
    
    // NOTE: Chat history is now managed in the main message handler
    // Do not add user message here to avoid duplication
    
    return new Promise((resolve, reject) => {
        // Use full path to python executable if needed
        const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
        const pythonProcess = spawn(pythonCommand, ['chatbot.py'], { 
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: __dirname // Ensure we're in the correct directory
        });
        
        let responseData = '';
        let errorData = '';
        let resolved = false;
        
        // Set up timeout first
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                pythonProcess.kill('SIGKILL');
                reject(new Error('Chatbot process timed out after 30 seconds.'));
            }
        }, 30000); // 30 seconds
        
        pythonProcess.stdout.on('data', (data) => {
            responseData += data.toString();
        });
        
        pythonProcess.stderr.on('data', (data) => {
            errorData += data.toString();
        });
        
        pythonProcess.on('close', (code) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            
            if (code !== 0) {
                console.error(`Chatbot process exited with code ${code}. Stderr: ${errorData}`);
                reject(new Error(`Chatbot error: ${errorData || 'Unknown error occurred'}`));
                return;
            }
            
            try {
                // Try to parse the response
                if (!responseData.trim()) {
                    reject(new Error('No response received from chatbot'));
                    return;
                }
                
                const result = JSON.parse(responseData.trim());
                if (result.error) {
                    console.error(`Error from chatbot.py: ${result.error}`);
                    reject(new Error(`Chatbot error: ${result.error}`));
                } else {
                    // Check if response is empty
                    if (!result.response || result.response.trim() === '') {
                        reject(new Error('Empty response received from chatbot'));
                        return;
                    }
                    
                    // Add bot's response to chat history
                    chatHistory.push({ role: 'model', parts: [{ text: result.response }] });
                    
                    // Update questions asked count - increment if the response contains a question
                    if (result.response.includes('?') && questionsAsked < maxQuestions) {
                        userSessions[userId].questionsAsked = questionsAsked + 1;
                        console.log(`🤔 Question detected. Count updated to: ${userSessions[userId].questionsAsked}/${maxQuestions}`);
                    } else {
                        // Keep the count as is
                        userSessions[userId].questionsAsked = questionsAsked;
                    }
                    
                    resolve(result.response);
                }
            } catch (e) {
                console.error(`Failed to parse JSON from chatbot.py: ${e}. Raw response: ${responseData}`);
                reject(new Error(`Invalid response format from chatbot. Raw: ${responseData.substring(0, 200)}...`));
            }
        });
        
        pythonProcess.on('error', (error) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                reject(new Error(`Failed to start Python process: ${error.message}`));
            }
        });
        
        // Send data to chatbot.py via stdin
        try {
            const inputData = JSON.stringify({
                message: messageText || "",
                pet_details: petDetails,
                chat_history: chatHistory,
                files: files, // Include files in the data sent to Python
                questions_asked: questionsAsked,
                max_questions: maxQuestions
            });
            console.log('Sending to Python:', {
                message: messageText || "",
                pet_details: petDetails,
                files_count: files.length,
                chat_history_length: chatHistory.length,
                questions_asked: questionsAsked,
                max_questions: maxQuestions
            });
            console.log('📜 Chat History Summary:');
            chatHistory.forEach((msg, idx) => {
                const role = msg.role === 'user' ? '👤 User' : '🤖 Bot';
                const text = msg.parts?.[0]?.text || '[Non-text content]';
                console.log(`  ${idx + 1}. ${role}: ${text.substring(0, 50)}...`);
            });
            pythonProcess.stdin.write(inputData);
            pythonProcess.stdin.end();
        } catch (error) {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                pythonProcess.kill('SIGKILL');
                reject(new Error(`Failed to send data to Python process: ${error.message}`));
            }
        }
    });
}

// Global error handling
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit on unhandled rejection, just log it
});

// Graceful shutdown handling
process.on('SIGINT', () => {
    console.log('Received SIGINT, stopping bot...');
    bot.stop('SIGINT');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, stopping bot...');
    bot.stop('SIGTERM');
    process.exit(0);
});

// Launch bot with appropriate method based on environment
async function startBot() {
    try {
        // Check if we're in a webhook environment (like Render, Heroku, etc.)
        const PORT = process.env.PORT || 3000;
        const WEBHOOK_URL = process.env.WEBHOOK_URL;
        
        if (WEBHOOK_URL) {
            // Production mode: Use webhooks with Express
            console.log(`Setting up webhook at ${WEBHOOK_URL}`);
            
            // Create Express app for webhook
            const app = express();
            app.use(express.json());
            
            // Health check endpoint
            app.get('/', (req, res) => {
                res.json({ 
                    status: 'ok', 
                    message: 'Petallyyy Telegram Bot is running',
                    timestamp: new Date().toISOString()
                });
            });
            
            // Health check for render
            app.get('/health', (req, res) => {
                res.json({ status: 'healthy' });
            });
            
            // Set up webhook
            const webhookPath = `/bot${token}`;
            await bot.telegram.setWebhook(`${WEBHOOK_URL}${webhookPath}`);
            
            // Use telegraf webhook middleware
            app.use(bot.webhookCallback(webhookPath));
            
            // Start server
            app.listen(PORT, () => {
                console.log(`Petallyyy Telegram Bot (Telegraf) is running on webhook mode at port ${PORT}...`);
                console.log(`Webhook URL: ${WEBHOOK_URL}${webhookPath}`);
            });
            
        } else {
            // Development mode: Use polling with better error handling
            console.log('Starting bot in polling mode (development)...');
            
            // Clear any existing webhook first
            await bot.telegram.deleteWebhook();
            
            // Launch with polling
            await bot.launch({
                polling: {
                    timeout: 10,
                    limit: 100,
                    allowedUpdates: ['message', 'callback_query']
                }
            });
            console.log('Petallyyy Telegram Bot (Telegraf) is running in polling mode...');
        }
    } catch (error) {
        console.error('Error starting bot:', error);
        
        // If it's a 409 conflict error, try to resolve it
        if (error.response && error.response.error_code === 409) {
            console.log('Detected conflict error. Attempting to clear webhook and restart...');
            try {
                await bot.telegram.deleteWebhook();
                console.log('Webhook cleared. Waiting 5 seconds before restart...');
                setTimeout(() => {
                    startBot();
                }, 5000);
                return;
            } catch (clearError) {
                console.error('Failed to clear webhook:', clearError);
            }
        }
        
        process.exit(1);
    }
}

// Start the bot
startBot();

