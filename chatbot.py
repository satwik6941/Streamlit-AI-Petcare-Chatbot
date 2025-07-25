import google_genai as genai
import os
import dotenv as env
import json
import sys

# Load environment variables from .env file
env.load_dotenv()

# Configure the generative AI model
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

def get_model(pet_name, pet_type, pet_age, pet_breed):
    """Creates a new model instance with a system prompt based on the current pet details."""
    system_prompt = f"""
You are an expert in pet care and veterinary medicines with 20+ years of experience.
Your responses should be concise, sharp, and fact-based.

When a user first describes a problem, your task is to gather more information by asking exactly 4 clarifying questions. Ask them one by one. After you have received the user's answers to all 4 questions, you must provide a final verdict.

Your final response structure should be:
**Analysis:** [Brief assessment of the pet's condition/situation based on the user's answers (MAX 3 lines)]
**Advice:** [Detailed general care recommendations and home solutions (MAX 3 lines)]

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
        'gemini-2.5-pro',
        system_instruction=system_prompt
    )
    return model

def get_response(pet_details, chat_history):
    """
    Gets a response from the generative AI model.
    `chat_history` is expected to be a list of dictionaries in the Gemini format.
    `pet_details` is a dictionary containing pet_name, pet_type, pet_age, pet_breed.
    """
    pet_name = pet_details.get("pet_name", "")
    pet_type = pet_details.get("pet_type", "")
    pet_age = pet_details.get("pet_age", "")
    pet_breed = pet_details.get("pet_breed", "")

    if not chat_history:
        return ""

    model = get_model(pet_name, pet_type, pet_age, pet_breed)
    model_history = chat_history[:-1]
    last_message_parts = chat_history[-1]["parts"]

    chat = model.start_chat(history=model_history)

    try:
        response = chat.send_message(last_message_parts)
        return response.text
    except Exception as e:
        print(f"Error getting response from Gemini: {e}", file=sys.stderr)
        return "Sorry, I encountered an error. Please try again."

if __name__ == "__main__":
    # Read input from stdin
    input_data = sys.stdin.read()
    try:
        data = json.loads(input_data)
        pet_details = data.get("pet_details")
        chat_history = data.get("chat_history")

        if not isinstance(pet_details, dict):
            print(json.dumps({"error": "Invalid 'pet_details' format. Expected a dictionary."}), file=sys.stderr)
            sys.exit(1)
        
        if not isinstance(chat_history, list):
            print(json.dumps({"error": "Invalid 'chat_history' format. Expected a list."}), file=sys.stderr)
            sys.exit(1)

        response_text = get_response(pet_details, chat_history)
        
        # Write response to stdout as JSON
        print(json.dumps({"response": response_text}))
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid input format. Please ensure the input is valid JSON."}), file=sys.stderr)
    except Exception as e:
        print(json.dumps({"error": "An unexpected error occurred while processing your request."}), file=sys.stderr)