import streamlit as st
import base64
from io import BytesIO
from PIL import Image
import chatbot

def display_chat(chat_history):
    """Displays the chat history in the Streamlit app."""
    for message in chat_history:
        with st.chat_message(message["role"]):
            # For the model's role, the content is in 'parts'
            if isinstance(message["content"], list):
                for part in message["content"]:
                    if isinstance(part, str):
                        st.markdown(part)
                    else: # Assumes it's an image
                        st.image(part, width=200)
            else: # For user's role, content is a simple string
                st.markdown(message["content"])

def main():
    st.set_page_config(page_title="AI Petcare Assistant", page_icon="🐾")
    st.title("🐾 AI Petcare Assistant")

    # Initialize session state
    if "chat_history" not in st.session_state:
        st.session_state.chat_history = []
    if "pet_details_submitted" not in st.session_state:
        st.session_state.pet_details_submitted = False

    # Get pet details
    if not st.session_state.pet_details_submitted:
        with st.form("pet_details_form"):
            st.write("Please enter your pet's details:")
            pet_name = st.text_input("Pet's Name")
            pet_type = st.selectbox("Pet Type", ["Dog", "Cat"])
            pet_age = st.text_input("Pet's Age")
            pet_breed = st.text_input("Pet's Breed")
            submitted = st.form_submit_button("Submit")

            if submitted:
                chatbot.pet_name = pet_name
                chatbot.pet_type = pet_type
                chatbot.pet_age = pet_age
                chatbot.pet_breed = pet_breed
                st.session_state.pet_details_submitted = True
                # Add a welcome message to the chat history
                st.session_state.chat_history.append({
                    "role": "model", 
                    "parts": [f"Great! I now know about {pet_name}, your {pet_age} year old {pet_breed} {pet_type}. How can I help you today?"]
                })
                st.rerun()

    else:
        # Display chat history
        for message in st.session_state.chat_history:
            with st.chat_message(message["role"]):
                # The content of the message is now in the 'parts' field
                st.markdown(message["parts"][0])

        # Chat input
        prompt = st.chat_input("Ask me anything about your pet...")
        uploaded_file = st.file_uploader("Upload an image", type=["png", "jpg", "jpeg"])

        if prompt:
            # Add user message to chat history
            user_message_parts = [prompt]
            if uploaded_file:
                image = Image.open(uploaded_file)
                user_message_parts.append(image)

            st.session_state.chat_history.append({"role": "user", "parts": user_message_parts})
            
            with st.chat_message("user"):
                st.markdown(prompt)
                if uploaded_file:
                    st.image(image, width=200)

            # Get chatbot response
            with st.spinner("Thinking..."):
                # Pass the correctly formatted history to the chatbot
                gemini_history = [
                    {"role": m["role"], "parts": m["parts"]} 
                    for m in st.session_state.chat_history
                ]
                response = chatbot.get_response(prompt, gemini_history)
                st.session_state.chat_history.append({"role": "model", "parts": [response]})

            # Display the new response
            with st.chat_message("model"):
                st.markdown(response)

if __name__ == "__main__":
    main()