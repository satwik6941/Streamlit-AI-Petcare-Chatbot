# -*- coding: utf-8 -*-
import google.generativeai as genai
import os
import dotenv as env
from io import BytesIO
from PIL import Image
import mimetypes

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

When a user first describes a problem, your task is to gather more information by asking exactly 4 clarifying questions. Ask them one by one. After you have received the user's answers to all 4 questions, you must provide a final verdict.

Your final response structure should be:
**Analysis:** [Brief assessment of the pet's condition/situation based on the user's answers]
**Advice:** [Detailed general care recommendations and home solutions]

Here are the details of the user's pet:
- Pet Name: {pet_name}
- Pet Type (Dog/Cat): {pet_type}
- Pet Age: {pet_age}
- Pet Breed: {pet_breed}

Important Guidelines:
- Focus on general care advice and home remedies.
- Only suggest veterinary consultation for serious, life-threatening situations.
- Do not provide a medical diagnosis or suggest specific brands.
- Always end your final advice with: "If you feel this is a very serious issue, please consult a veterinarian for further assistance."
"""
    model = genai.GenerativeModel(
        'gemini-1.5-pro-latest',  # Updated model to support multimodal inputs
        system_instruction=system_prompt
    )
    return model

def get_response(chat_history):
    """
    Gets a response from the generative AI model.
    `chat_history` is expected to be a list of dictionaries in the Gemini format.
    e.g., [{{"role": "user", "parts": ["Hello", {{"mime_type": "image/jpeg", "data": ...}}]}}]
    """
    if not chat_history:
        return ""

    model = get_model()
    # The history for the model should not include the last user message
    model_history = chat_history[:-1]
    last_message_parts = chat_history[-1]["parts"]

    chat = model.start_chat(history=model_history)

    try:
        response = chat.send_message(last_message_parts)
        return response.text
    except Exception as e:
        print(f"Error getting response from Gemini: {e}")
        return "Sorry, I encountered an error. Please try again."

def prepare_file(uploaded_file):
    """
    Prepares an uploaded file for the Gemini API.
    Returns a dict with mime_type and data.
    """
    if uploaded_file is None:
        return None
    
    # Read the file bytes
    bytes_data = uploaded_file.getvalue()
    
    # Guess the MIME type
    mime_type, _ = mimetypes.guess_type(uploaded_file.name)
    
    # If MIME type can't be guessed, default to octet-stream
    if mime_type is None:
        mime_type = 'application/octet-stream'
        
    return {
        "mime_type": mime_type,
        "data": bytes_data
    }