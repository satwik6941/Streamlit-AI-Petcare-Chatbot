# AI Petcare Chatbot - Setup Guide

## Features
- **Interactive Pet Registration**: Collects pet details with user-friendly buttons
- **Smart Question System**: Asks only one question at a time, maximum 4 questions
- **Expert Analysis**: Provides professional pet care advice and recommendations

## Pet Details Collection Flow
1. **Name**: User types pet's name
2. **Type**: Dog or Cat (buttons)
3. **Age**: 1-10 years or custom (buttons)
4. **Breed**: User types breed
5. **Gender**: Male or Female (buttons)  
6. **Weight**: User types weight with unit

## Quick Setup

### 1. Environment Setup
```bash
# Copy the environment template
copy .env.template .env

# Edit .env and add your API keys:
# GEMINI_API_KEY=your_gemini_api_key_here
# TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
```

### 2. Install Dependencies
```bash
# Python dependencies
pip install -r requirements.txt

# Node.js dependencies  
npm install
```

### 3. Test the System
```bash
# Test bot connection
node test_bot.js

# Test Python chatbot
python test_chatbot.py

# Run Telegram bot with debugging
node petallyyy_bot.js

# Run Streamlit UI (optional)
streamlit run ui.py
```

## Troubleshooting

### Button Issues
If buttons are not working:
1. Check that your `.env` file has the correct `TELEGRAM_BOT_TOKEN`
2. Restart the bot: stop with `Ctrl+C` and run `node petallyyy_bot.js` again
3. Check console logs for error messages
4. Try `/reset` command to restart the conversation

### Common Errors
- **"Session expired"**: Use `/start` or `/reset` to begin again
- **Buttons not responding**: Check bot logs and restart the bot
- **"API key not configured"**: Verify `GEMINI_API_KEY` in `.env` file

## Bot Commands
- `/start` or `hi` - Start new conversation
- `/reset` - Reset and start over
- `/restart` - Same as reset
- `/newpet` - Register new pet

## How It Works
1. User greets the bot
2. Bot collects pet details step by step with buttons/text input
3. User describes pet's issue
4. Bot asks up to 4 clarifying questions (one at a time)
5. Bot provides analysis and advice

## API Keys Required
- **Google Gemini API**: Get from [Google AI Studio](https://aistudio.google.com/app/apikey)
- **Telegram Bot Token**: Get from [@BotFather](https://t.me/botfather) on Telegram
