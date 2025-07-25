from google import genai
import os
import dotenv as env
import json
import sys

# Load environment variables from .env file
env.load_dotenv()

# Configure the generative AI model
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Global variables for pet details (used by Streamlit UI)
pet_name = ""
pet_type = ""
pet_age = ""
pet_breed = ""

def get_system_prompt(pet_name, pet_type, pet_age, pet_breed, questions_asked=0, max_questions=4):
    """Creates a system prompt based on the current pet details and question tracking."""
    questions_remaining = max_questions - questions_asked
    
    if questions_remaining > 0:
        question_instruction = f"""
IMPORTANT CONVERSATION FLOW:
- You have asked {questions_asked} questions so far
- You can ask {questions_remaining} more questions maximum
- Ask only ONE specific clarifying question per response
- Wait for the user's response before asking the next question
- After gathering enough information (or reaching {max_questions} questions), provide your final assessment
"""
    else:
        question_instruction = f"""
IMPORTANT: You have already asked {max_questions} questions. Do NOT ask any more questions.
Provide your final assessment and advice based on the information gathered.
"""
    
    return f"""
You are an expert in pet care and veterinary medicines with 20+ years of experience.
Your responses should be concise, sharp, and fact-based.

{question_instruction}

Your final response structure should be:
**Analysis:** [Brief assessment of the pet's condition/situation based on the user's answers (MAX 3 lines)]
**Advice:** [Detailed general care recommendations and home solutions (MAX 3 lines)]

Here are the details of the user's pet:
- Pet Name: {pet_name}
- Pet Type (Dog/Cat): {pet_type}
- Pet Age: {pet_age}
- Pet Breed: {pet_breed}

Important Guidelines:
- Ask only ONE question per response (if you haven't reached the limit)
- Ask relevant, specific questions about symptoms, duration, behavior changes, etc.
- Focus on general care advice and home remedies in your final advice
- Only suggest veterinary consultation for serious, life-threatening situations
- Do not provide a medical diagnosis or suggest specific brands
- Always end your final advice with: "If you feel this is a very serious issue, please consult a veterinarian for further assistance."
"""

def get_response(chat_history_or_pet_details, chat_history=None):
    """
    Gets a response from the generative AI model.
    Can be called in two ways:
    1. get_response(chat_history) - Uses global pet variables (for Streamlit UI)
    2. get_response(pet_details, chat_history) - Uses provided pet details (for CLI)
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
            questions_asked = 0  # Default for Streamlit UI
            max_questions = 4
        else:
            # Called from CLI with pet_details and chat_history
            pet_details = chat_history_or_pet_details
            current_pet_name = pet_details.get("pet_name", "")
            current_pet_type = pet_details.get("pet_type", "")
            current_pet_age = pet_details.get("pet_age", "")
            current_pet_breed = pet_details.get("pet_breed", "")
            questions_asked = pet_details.get("questions_asked", 0)
            max_questions = pet_details.get("max_questions", 4)

        if not chat_history:
            return ""

        # Get the system prompt with question tracking
        system_prompt = get_system_prompt(current_pet_name, current_pet_type, current_pet_age, current_pet_breed, questions_asked, max_questions)
        
        # Prepare the conversation for the API call
        contents = []
        
        # Add system prompt as the first message
        contents.append({
            "role": "user",
            "parts": [{"text": f"System instruction: {system_prompt}"}]
        })
        
        # Convert chat history to proper format
        for message in chat_history:
            if message.get("role") == "user":
                parts = []
                for part in message.get("parts", []):
                    if "text" in part:
                        parts.append({"text": part["text"]})
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
            model="gemini-1.5-flash",
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

        response_text = get_response(pet_details, chat_history)
        
        # Write response to stdout as JSON
        print(json.dumps({"response": response_text}))
    except Exception as e:
        print(json.dumps({"error": f"An unexpected error occurred: {str(e)}"}), file=sys.stderr)
        sys.exit(1)