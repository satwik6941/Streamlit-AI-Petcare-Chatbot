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

# Global variables for pet details (used by Streamlit UI)
pet_name = ""
pet_type = ""
pet_age = ""
pet_breed = ""
pet_gender = ""
pet_weight = ""

def get_system_prompt(pet_name, pet_type, pet_age, pet_breed, pet_gender="", pet_weight="", questions_asked=0, max_questions=4, has_images=False):
    """Creates a system prompt based on the current pet details and question tracking."""
    questions_remaining = max_questions - questions_asked
    
    if questions_remaining > 0:
        question_instruction = f"""
CONVERSATION CONTEXT:
- This is an ongoing consultation about {pet_name}
- You have asked {questions_asked} questions so far
- You can ask {questions_remaining} more questions maximum
- Ask only ONE simple, direct question per response
- Build upon previous answers to ask follow-up questions
- Remember what the owner has already told you
- After gathering enough information (or reaching {max_questions} questions), provide your final assessment
"""
    else:
        question_instruction = f"""
CONVERSATION CONTEXT:
- This is an ongoing consultation about {pet_name}
- You have already asked {max_questions} questions
- You should now provide your final assessment and recommendations
- Base your advice on ALL the information gathered during this conversation
- Do NOT ask any more questions
"""
    
    image_instruction = ""
    if has_images:
        image_instruction = """
VISUAL INFORMATION:
- The owner has provided images/media
- Analyze them carefully for symptoms, conditions, or relevant details
- Describe what you see in the images and how it relates to the pet's health
- Reference the images in your questions or recommendations
"""
    
    return f"""
You are Dr. Paws, an experienced veterinarian conducting a consultation with a pet owner.

CONSULTATION STYLE:
- This is a continuing conversation - remember what has been discussed
- Speak naturally like a caring veterinarian 
- Ask simple, direct questions that build on previous answers
- Show empathy and genuine concern for {pet_name}'s wellbeing
- Use {pet_name}'s name throughout the conversation
- Reference previous symptoms or information the owner has shared

{question_instruction}

{image_instruction}

RESPONSE FORMAT:
- For questions: Ask ONE specific follow-up question based on what you already know
- For final assessment:
  **My Assessment:** [Clear diagnosis/assessment based on ALL conversation history]
  **What I Recommend:** [Specific care advice based on everything discussed]

Pet Details:
- Name: {pet_name}
- Type: {pet_type}
- Age: {pet_age}
- Breed: {pet_breed}
- Gender: {pet_gender}
- Weight: {pet_weight}

QUESTION GUIDELINES:
- Reference what the owner already told you: "You mentioned [previous symptom]..."
- Ask logical follow-ups: "Since [pet_name] is vomiting, is there any blood in it?"
- Show continuity: "Earlier you said [pet_name] wasn't eating well..."

Always end final recommendations with: "If you're concerned or if things don't improve, I'd recommend seeing your local vet for a hands-on examination."
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

def get_response(chat_history_or_pet_details, chat_history=None, files=None):
    """
    Gets a response from the generative AI model.
    Can be called in two ways:
    1. get_response(chat_history) - Uses global pet variables (for Streamlit UI)
    2. get_response(pet_details, chat_history, files) - Uses provided pet details (for CLI)
    """
    try:
        # Determine which calling pattern is being used
        if chat_history is None:
            # Called from Streamlit UI with only chat_history
            chat_history = chat_history_or_pet_details
            current_pet_name = pet_name
            current_pet_type = pet_type
            current_pet_age = pet_age
            current_pet_breed = pet_breed
            current_pet_gender = pet_gender
            current_pet_weight = pet_weight
            questions_asked = 0  # Default for Streamlit UI
            max_questions = 4
            files = files or []
        else:
            # Called from CLI with pet_details and chat_history
            pet_details = chat_history_or_pet_details
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
            return ""

        # Check if we have images/files to process
        has_images = any(f.get('type') == 'image' for f in files) if files else False

        # Get the system prompt with question tracking and image support
        system_prompt = get_system_prompt(current_pet_name, current_pet_type, current_pet_age, current_pet_breed, current_pet_gender, current_pet_weight, questions_asked, max_questions, has_images)
        
        # Prepare the conversation for the API call
        contents = []
        
        # Add system prompt only if this is the first message in the conversation
        if not chat_history or len(chat_history) == 0:
            contents.append({
                "role": "user",
                "parts": [{"text": f"System instruction: {system_prompt}"}]
            })
            contents.append({
                "role": "model",
                "parts": [{"text": "I understand. I'm Dr. Paws, and I'm ready to help with your pet consultation. Please tell me what's concerning you about your pet today."}]
            })
        
        # For ongoing conversations, add a context reminder instead of full system prompt
        elif len(chat_history) > 0:
            context_reminder = f"""
            Context: Ongoing consultation for {current_pet_name} ({current_pet_type}, {current_pet_age}).
            Questions asked so far: {questions_asked}/{max_questions}.
            {f"Images provided: Yes" if has_images else ""}
            Continue the consultation naturally, building on previous conversation.
            """
            contents.append({
                "role": "user",
                "parts": [{"text": context_reminder}]
            })
            contents.append({
                "role": "model",
                "parts": [{"text": "I'll continue our consultation, keeping in mind everything we've discussed so far."}]
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
        chat_history = data.get("chat_history")
        files = data.get("files", [])  # Extract files from input
        questions_asked = data.get("questions_asked", 0)
        max_questions = data.get("max_questions", 4)

        if not isinstance(pet_details, dict):
            print(json.dumps({"error": "Invalid 'pet_details' format. Expected a dictionary."}), file=sys.stderr)
            sys.exit(1)
        
        if not isinstance(chat_history, list):
            print(json.dumps({"error": "Invalid 'chat_history' format. Expected a list."}), file=sys.stderr)
            sys.exit(1)

        # Add question tracking to pet_details
        pet_details["questions_asked"] = questions_asked
        pet_details["max_questions"] = max_questions

        response_text = get_response(pet_details, chat_history, files)
        
        # Write response to stdout as JSON
        print(json.dumps({"response": response_text}))
    except Exception as e:
        print(json.dumps({"error": f"An unexpected error occurred: {str(e)}"}), file=sys.stderr)
        sys.exit(1)