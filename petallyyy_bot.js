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

// List of greeting keywords
const GREETINGS = ['hi', 'hello', '/start', 'hey', 'greetings'];

// Reset command to restart conversation
const RESET_COMMANDS = ['/reset', '/restart', '/newpet'];

// Pet detail prompts with button configurations
const PET_DETAIL_FIELDS = [
    { key: 'pet_name', prompt: 'What is your pet\'s name?', type: 'text' },
    { key: 'pet_type', prompt: 'Is your pet a Dog or a Cat?', type: 'buttons', options: ['Dog', 'Cat'] },
    { key: 'pet_age', prompt: 'How old is your pet?', type: 'buttons', options: ['1 year', '2 years', '3 years', '4 years', '5 years', '6 years', '7 years', '8 years', '9 years', '10 years', 'Custom'] },
    { key: 'pet_breed', prompt: 'What is your pet\'s breed?', type: 'text' },
    { key: 'pet_gender', prompt: 'What is your pet\'s gender?', type: 'buttons', options: ['Male', 'Female'] },
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
    // Handle photos
    if (ctx.message.photo) {
        // Get the highest resolution photo
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        files.push({
            type: 'image',
            file_id: photo.file_id,
            file_link: fileLink.href,
            file_unique_id: photo.file_unique_id
        });
    }
    // Handle documents (PDFs, videos, etc.)
    if (ctx.message.document) {
        const doc = ctx.message.document;
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        files.push({
            type: doc.mime_type.startsWith('image/') ? 'image' : doc.mime_type,
            file_id: doc.file_id,
            file_link: fileLink.href,
            file_name: doc.file_name,
            mime_type: doc.mime_type
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
            mime_type: video.mime_type
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
            mime_type: audio.mime_type
        });
    }
    // Handle voice
    if (ctx.message.voice) {
        const voice = ctx.message.voice;
        const fileLink = await ctx.telegram.getFileLink(voice.file_id);
        files.push({
            type: 'voice',
            file_id: voice.file_id,
            file_link: fileLink.href,
            mime_type: voice.mime_type
        });
    }
    return files;
}

// Enhanced message handler for all content types
bot.on(['text', 'photo', 'document', 'video', 'audio', 'voice'], async (ctx) => {
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
            maxQuestions: 4,   // Maximum questions allowed
            waitingForCustomAge: false // Flag for custom age input
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
        session.waitingForCustomAge = false;
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
        session.waitingForCustomAge = false;
        await ctx.reply('Starting fresh! Let\'s begin again.');
        await ctx.reply('Hello! I\'m Dr. Paws, your friendly pet care assistant.');
        await sendPetDetailPrompt(ctx, session);
        return;
    }

    // Handle custom age input
    if (session.waitingForCustomAge) {
        const customAge = messageText.trim();
        if (customAge) {
            session.petDetails.pet_age = customAge;
            session.petDetailStep++;
            session.waitingForCustomAge = false;
            await sendPetDetailPrompt(ctx, session);
        } else {
            await ctx.reply('Please enter a valid age for your pet.');
        }
        return;
    }

    // If not ready, collect pet details step by step
    if (!session.ready) {
        const currentField = PET_DETAIL_FIELDS[session.petDetailStep];
        if (currentField) {
            if (currentField.type === 'text') {
                // Handle text input
                session.petDetails[currentField.key] = messageText.trim();
                session.petDetailStep++;
                await sendPetDetailPrompt(ctx, session);
                return;
            } else if (currentField.type === 'buttons') {
                // For button inputs, ignore text messages and show reminder
                await ctx.reply('Please use the buttons above to make your selection.');
                return;
            }
        }
    }

    // After pet details, start main conversation
    try {
        // Add multimodal input to chat history
        const userParts = [];
        if (messageText) userParts.push({ text: messageText });
        if (files.length > 0) {
            for (const file of files) {
                userParts.push({ file });
            }
        }
        if (userParts.length > 0) {
            session.chatHistory.push({ role: 'user', parts: userParts });
        }
        // Call chatbot.py with full context
        const response = await getChatbotResponse(userId, messageText, files);
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
        // All details collected
        session.ready = true;
        console.log('All pet details collected:', session.petDetails);
        await ctx.reply(`Great! Here's what I know about your pet:
🐾 Name: ${session.petDetails.pet_name}
🐕/🐱 Type: ${session.petDetails.pet_type}
📅 Age: ${session.petDetails.pet_age}
🏷️ Breed: ${session.petDetails.pet_breed}
♂️/♀️ Gender: ${session.petDetails.pet_gender}
⚖️ Weight: ${session.petDetails.pet_weight}`);
        await ctx.reply('How can I help you today? Please describe your pet\'s issue or send any relevant files (images, videos, PDFs, etc.).');
        return;
    }

    if (currentField.type === 'text') {
        await ctx.reply(currentField.prompt);
    } else if (currentField.type === 'buttons') {
        const keyboard = {
            inline_keyboard: []
        };
        
        console.log(`Creating buttons for ${currentField.key} with options:`, currentField.options);
        
        if (currentField.key === 'pet_age') {
            // Create age buttons in rows of 5
            const ageButtons = [];
            for (let i = 0; i < currentField.options.length; i++) {
                const callbackData = `${currentField.key}_${currentField.options[i].replace(/\s/g, '_')}`;
                ageButtons.push({
                    text: currentField.options[i],
                    callback_data: callbackData
                });
                
                // Add row every 5 buttons or at the end
                if ((i + 1) % 5 === 0 || i === currentField.options.length - 1) {
                    keyboard.inline_keyboard.push([...ageButtons]);
                    ageButtons.length = 0; // Clear the array
                }
            }
        } else {
            // For other button types (pet_type, pet_gender), create single row
            keyboard.inline_keyboard.push(
                currentField.options.map(option => ({
                    text: option,
                    callback_data: `${currentField.key}_${option}`
                }))
            );
        }
        
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
            maxQuestions: 4,
            waitingForCustomAge: false
        };
    }
    
    const session = userSessions[userId];
    
    // Parse callback data (format: fieldKey_value)
    const [fieldKey, ...valueParts] = data.split('_');
    const rawValue = valueParts.join('_');
    const displayValue = valueParts.join(' '); // Join back with spaces for display
    
    console.log(`Parsed: fieldKey=${fieldKey}, rawValue=${rawValue}, displayValue=${displayValue}`);
    
    try {
        if (fieldKey === 'pet_age' && rawValue === 'Custom') {
            session.waitingForCustomAge = true;
            await ctx.answerCbQuery();
            await ctx.editMessageText('Please type your pet\'s age (e.g., "6 months", "2.5 years"):');
        } else {
            // Store the selected value
            session.petDetails[fieldKey] = displayValue;
            session.petDetailStep++;
            
            console.log(`Stored ${fieldKey} = ${displayValue}, moving to step ${session.petDetailStep}`);
            
            await ctx.answerCbQuery();
            
            // Find the current field to get the prompt
            const currentField = PET_DETAIL_FIELDS.find(f => f.key === fieldKey);
            if (currentField) {
                await ctx.editMessageText(`${currentField.prompt}\n✅ Selected: ${displayValue}`);
            }
            
            // Move to next step
            await sendPetDetailPrompt(ctx, session);
        }
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
    const { chatHistory, petDetails, questionsAsked, maxQuestions } = userSessions[userId];
    
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
                    // Add bot's response to chat history
                    chatHistory.push({ role: 'model', parts: [{ text: result.response }] });
                    
                    // Check if this response contains a question (and we haven't reached max questions)
                    if (result.response.includes('?') && questionsAsked < maxQuestions) {
                        userSessions[userId].questionsAsked++;
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
                pet_details: petDetails,
                chat_history: chatHistory,
                questions_asked: questionsAsked,
                max_questions: maxQuestions
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
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

bot.launch();
console.log('Petallyyy Telegram Bot (Telegraf) is running...');

