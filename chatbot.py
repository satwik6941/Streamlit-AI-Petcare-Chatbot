# -*- coding: utf-8 -*-
import google.generativeai as genai
import os
import dotenv as env
from io import BytesIO
from PIL import Image
import re
import base64

# Load environment variables from .env file
env.load_dotenv()

# Configure the generative AI model
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

# Pet details - these will be updated from the Streamlit app
pet_name = ""
pet_type = ""
pet_age = ""
pet_breed = ""

def get_model():
    """Creates a new model instance with a system prompt based on the current pet details."""
    system_prompt = f"""
You are an expert in pet care and veterinary medicines with 20+ years of experience.
Your responses should be concise, sharp, and fact-based.
When a user asks a question, you may ask up to 2-3 clarifying questions to gather more information before providing a detailed analysis and advice.
After gathering enough information, provide a direct, factual analysis and advice.

Here are the details of the user's pet:
- Pet Name: {pet_name}
- Pet Type (Dog/Cat): {pet_type}
- Pet Age: {pet_age}
- Pet Breed: {pet_breed}

Your final response structure should be:
**Analysis:** [Brief assessment of the pet's condition/situation]
**Advice:** [Detailed general care recommendations and home solutions]

Important Guidelines:
- Focus on general care advice and home remedies.
- Only suggest veterinary consultation for serious, life-threatening situations.
- Do not provide a medical diagnosis or suggest specific brands.
- Always end your final advice with: "If you feel this is a very serious issue, please consult a veterinarian for further assistance."
"""
    model = genai.GenerativeModel(
        'gemini-1.5-flash',
        system_instruction=system_prompt
    )
    return model

def parse_multimodal_input(user_input):
    """Parses user input to separate text from media markers and decode media."""
    pattern = r"\[MEDIA\|([^|]+)\|([^\]]+)\]"
    text_content = re.sub(pattern, "", user_input).strip()
    matches = list(re.finditer(pattern, user_input))
    
    parts = []
    if text_content:
        parts.append(text_content)

    for match in matches:
        mime_type, b64_data = match.group(1), match.group(2)
        if mime_type.startswith('image/'):
            try:
                image_bytes = base64.b64decode(b64_data)
                img = Image.open(BytesIO(image_bytes))
                parts.append(img)
            except Exception as e:
                print(f"[ERROR] Failed to decode image: {e}")
    
    return parts if parts else [""]

def get_response(user_input, chat_history):
    """
    Gets a response from the generative AI model.
    `chat_history` is expected to be a list of dictionaries in the Gemini format,
    e.g., [{"role": "user", "parts": ["Hello"]}, {"role": "model", "parts": ["Hi there!"]}]
    """
    if not user_input:
        return ""

    model = get_model()
    chat = model.start_chat(history=chat_history)
    prompt_parts = parse_multimodal_input(user_input)

    try:
        response = chat.send_message(prompt_parts)
        return response.text
    except Exception as e:
        print(f"Error getting response from Gemini: {e}")
        return "Sorry, I encountered an error. Please try again."
