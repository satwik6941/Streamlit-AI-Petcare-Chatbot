from google import genai
import os
import dotenv as env
import json
import sys
import requests
from PIL import Image
import io

# Load environment variables from .env file
env.load_dotenv()

# Configure the generative AI model
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Single consistent system prompt
SYSTEM_PROMPT = """
You are an expert, helpful and friendly veterinary doctor who has 20+ years of experience. You have many great achievements and awards in the field of pet health and understand pet feelings deeply.

Your task is to conduct a professional veterinary consultation and friendly with pet owners. You will ask a maximum of 4 questions to gather essential information about the pet's condition, then provide your assessment and recommendations.

CONSULTATION PROCESS:
1. Ask ONE question at a time (maximum 4 questions total)
2. Each question should be 1-2 lines only
3. Wait for the owner's response before asking the next question
4. Build upon previous answers to ask relevant follow-up questions
5. After all 4 questions (or fewer if sufficient information is gathered), provide your complete assessment

QUESTION GUIDELINES:
- Keep questions short and direct (1-2 lines maximum)
- Ask about symptoms, duration, behavior changes, eating habits, etc.
- Reference the pet's name when asking questions
- Ask logical follow-ups based on previous answers

RESPONSE FORMAT:
- For questions: Ask ONLY ONE direct question. No analysis or advice yet.
- For responses: Use the pet's name and be caring and professional
- Responses other than final assessment should be concise and focused on the pet's condition
- For final assessment: Provide structured response with:
  **My Assessment:** [Clear diagnosis/assessment based on all information] in 4 lines at maximum
  **What I Recommend:** [Specific care advice and next steps] in 4 lines at maximum in the format of bullet points
- If and only if and only if the issue is serious, tell "Emergency Alert: "⚠️ URGENT: Based on the symptoms you've described, your pet needs immediate veterinary attention. PLease consult your local vet as soon as possible."

IMPORTANT RULES:
- Never ask more than 4 questions total
- Always ask questions one by one
- Do NOT provide analysis or recommendations until questioning is complete
- Always end final recommendations with: "If you're concerned or if things don't improve, I'd recommend seeing your local vet for a hands-on examination."
- Be caring, professional, and use the pet's name throughout the conversation
"""

def download_and_process_image(file_url):
    """Download and process image from URL for Gemini API."""
    try:
        response = requests.get(file_url, timeout=10)
        response.raise_for_status()
        
        # Open and process the image
        image = Image.open(io.BytesIO(response.content))
        
        # Convert to RGB if necessary
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Resize if too large (Gemini has size limits)
        max_size = (1024, 1024)
        if image.size[0] > max_size[0] or image.size[1] > max_size[1]:
            image.thumbnail(max_size, Image.Resampling.LANCZOS)
        
        # Convert back to bytes
        img_byte_arr = io.BytesIO()
        image.save(img_byte_arr, format='JPEG', quality=85)
        img_byte_arr.seek(0)
        
        return img_byte_arr.getvalue()
    except Exception as e:
        print(f"Error processing image from {file_url}: {str(e)}", file=sys.stderr)
        return None

def get_response(pet_details, chat_history, files=None):
    """Gets a response from the generative AI model."""
    try:
        # Extract pet details
        current_pet_name = pet_details.get("pet_name", "")
        current_pet_type = pet_details.get("pet_type", "")
        current_pet_age = pet_details.get("pet_age", "")
        current_pet_breed = pet_details.get("pet_breed", "")
        current_pet_gender = pet_details.get("pet_gender", "")
        current_pet_weight = pet_details.get("pet_weight", "")
        questions_asked = pet_details.get("questions_asked", 0)
        max_questions = pet_details.get("max_questions", 4)
        files = files or []

        if not chat_history:
            chat_history = []

        # Check if we have images/files to process
        has_images = any(f.get('type') == 'image' for f in files) if files else False

        # Prepare the conversation for the API call
        contents = []
        
        # Add system prompt and pet details for every conversation
        pet_info = f"""
Pet Information:
- Name: {current_pet_name}
- Type: {current_pet_type}
- Age: {current_pet_age}
- Breed: {current_pet_breed}
- Gender: {current_pet_gender}
- Weight: {current_pet_weight}

Current Status: Questions asked so far: {questions_asked}/{max_questions}
{f"Images provided: Yes" if has_images else ""}
"""
        
        contents.append({
            "role": "user",
            "parts": [{"text": f"{SYSTEM_PROMPT}\n\n{pet_info}"}]
        })
        
        # Add initial greeting if this is the first message
        if not chat_history or len(chat_history) == 0:
            contents.append({
                "role": "model",
                "parts": [{"text": f"Hello! I'm Dr. Paws, your veterinary consultant. I'd like to help assess {current_pet_name}'s condition. I'll ask you a few questions to better understand what's going on."}]
            })
            
            # Add a default user message if none provided
            initial_message = f"I'd like to get a consultation for my {current_pet_type}, {current_pet_name}."
            contents.append({
                "role": "user",
                "parts": [{"text": initial_message}]
            })
        
        # Convert chat history to proper format with multimodal support
        for message in chat_history:
            if message.get("role") == "user":
                parts = []
                for part in message.get("parts", []):
                    if "text" in part:
                        parts.append({"text": part["text"]})
                    elif "file" in part:
                        file_info = part["file"]
                        if file_info.get("type") == "image":
                            # Download and process image
                            image_data = download_and_process_image(file_info.get("file_link"))
                            if image_data:
                                parts.append({
                                    "inline_data": {
                                        "mime_type": "image/jpeg",
                                        "data": image_data
                                    }
                                })
                            else:
                                parts.append({"text": f"[Image could not be processed: {file_info.get('file_name', 'unknown')}]"})
                        else:
                            parts.append({"text": f"[File: {file_info.get('file_name', 'unknown')} - {file_info.get('type', 'unknown type')}]"})
                if parts:
                    contents.append({"role": "user", "parts": parts})
            elif message.get("role") == "model" or message.get("role") == "assistant":
                parts = []
                for part in message.get("parts", []):
                    if "text" in part:
                        parts.append({"text": part["text"]})
                if parts:
                    contents.append({"role": "model", "parts": parts})

        # Generate response using the correct API format
        response = client.models.generate_content(
            model="gemini-2.5-pro",
            contents=contents
        )
        return response.text
    except Exception as e:
        error_msg = f"Error getting response from Gemini: {str(e)}"
        print(error_msg, file=sys.stderr)
        return "Sorry, I encountered an error. Please try again."

if __name__ == "__main__":
    try:
        # Check if API key is available
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print(json.dumps({"error": "GEMINI_API_KEY environment variable is not set."}), file=sys.stderr)
            sys.exit(1)
        
        # Read input from stdin
        input_data = sys.stdin.read()
        if not input_data.strip():
            print(json.dumps({"error": "No input data received."}), file=sys.stderr)
            sys.exit(1)
            
        try:
            data = json.loads(input_data)
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"Invalid JSON input: {str(e)}"}), file=sys.stderr)
            sys.exit(1)
            
        pet_details = data.get("pet_details")
        chat_history = data.get("chat_history", [])
        files = data.get("files", [])
        questions_asked = data.get("questions_asked", 0)
        max_questions = data.get("max_questions", 4)
        message = data.get("message", "")

        if not isinstance(pet_details, dict):
            print(json.dumps({"error": "Invalid 'pet_details' format. Expected a dictionary."}), file=sys.stderr)
            sys.exit(1)
        
        if not isinstance(chat_history, list):
            print(json.dumps({"error": "Invalid 'chat_history' format. Expected a list."}), file=sys.stderr)
            sys.exit(1)

        # If there's a message and empty chat history, add it to chat history
        if message and len(chat_history) == 0:
            chat_history.append({
                "role": "user",
                "parts": [{"text": message}]
            })

        # Add question tracking to pet_details
        pet_details["questions_asked"] = questions_asked
        pet_details["max_questions"] = max_questions

        response_text = get_response(pet_details, chat_history, files)
        
        # Write response to stdout as JSON
        print(json.dumps({"response": response_text}))
    except Exception as e:
        print(json.dumps({"error": f"An unexpected error occurred: {str(e)}"}), file=sys.stderr)
        sys.exit(1)