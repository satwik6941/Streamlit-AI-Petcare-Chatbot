import streamlit as st
from io import BytesIO
from PIL import Image
import chatbot

def main():
    st.set_page_config(page_title="AI Petcare Assistant", page_icon="🐾")
    st.title("🐾 AI Petcare Assistant")

    # Initialize session state
    if "chat_history" not in st.session_state:
        st.session_state.chat_history = []
    if "pet_details_submitted" not in st.session_state:
        st.session_state.pet_details_submitted = False
    if "uploaded_file_content" not in st.session_state:
        st.session_state.uploaded_file_content = None

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
                st.session_state.chat_history.append({
                    "role": "model",
                    "parts": [f"Great! I now know about {pet_name}, your {pet_age} year old {pet_breed} {pet_type}. How can I help you today?"]
                })
                st.rerun()

    else:
        # Display chat history
        for message in st.session_state.chat_history:
            with st.chat_message(message["role"]):
                for part in message["parts"]:
                    if isinstance(part, str):
                        st.markdown(part)
                    elif isinstance(part, Image.Image):
                        st.image(part, width=200)

        # Enhanced CSS for a modern, visually appealing chat input bar
        st.markdown("""
        <style>
        .chat-input-outer {
            display: flex;
            justify-content: center;
            margin-top: 18px;
        }
        .chat-input-container {
            display: flex;
            align-items: center;
            background: #232a35;
            border-radius: 32px;
            box-shadow: 0 2px 12px 0 rgba(0,0,0,0.10);
            padding: 6px 16px 6px 16px;
            min-width: 350px;
            max-width: 700px;
            width: 100%;
        }
        .chat-input {
            flex: 1;
            background: transparent;
            border: none;
            color: #fff;
            font-size: 1.08rem;
            outline: none;
            padding: 10px 0 10px 0;
            margin: 0 8px;
        }
        .chat-input:focus {
            background: #232a35;
            box-shadow: 0 0 0 2px #4a90e2;
            border-radius: 20px;
        }
        .icon-btn {
            background: none;
            border: none;
            color: #b0b8c1;
            font-size: 1.45rem;
            margin: 0 6px 0 0;
            cursor: pointer;
            border-radius: 50%;
            transition: background 0.18s, color 0.18s;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 36px;
            width: 36px;
        }
        .icon-btn:hover {
            background: #2c3440;
            color: #4a90e2;
        }
        .send-btn {
            background: #4a90e2;
            color: #fff;
            border: none;
            border-radius: 50%;
            width: 42px;
            height: 42px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
            margin-left: 8px;
            cursor: pointer;
            transition: background 0.18s;
            box-shadow: 0 2px 8px 0 rgba(74,144,226,0.10);
        }
        .send-btn:hover {
            background: #357ab8;
        }
        .file-preview {
            color: #b0b8c1;
            font-size: 0.97rem;
            margin-left: 10px;
            margin-right: 0;
            display: flex;
            align-items: center;
            background: #232a35;
            border-radius: 12px;
            padding: 2px 8px;
        }
        .remove-file-btn {
            background: none;
            border: none;
            color: #e57373;
            font-size: 1.1rem;
            margin-left: 6px;
            cursor: pointer;
            border-radius: 50%;
            transition: background 0.18s;
        }
        .remove-file-btn:hover {
            background: #2c3440;
        }
        @media (max-width: 600px) {
            .chat-input-container { min-width: 0; max-width: 100vw; }
        }
        </style>
        """, unsafe_allow_html=True)

        # --- Place chat input at the bottom ---
        chat_input_placeholder = st.empty()
        with chat_input_placeholder.container():
            uploaded_file = st.file_uploader("Upload an image or file", type=["png", "jpg", "jpeg", "gif", "bmp", "webp", "pdf", "txt"], key="file_upload")
            prompt = st.text_input("Ask me anything about what you're learning...", key="prompt_input")
            send_clicked = st.button("Send")

        # Attach file only to this prompt, then clear
        if send_clicked and prompt:
            user_message_parts = [prompt]
            image = None
            if uploaded_file is not None:
                file_bytes = uploaded_file.read()
                try:
                    image = Image.open(BytesIO(file_bytes))
                    user_message_parts.append(image)
                except Exception:
                    user_message_parts.append(uploaded_file.name or "File uploaded")
            st.session_state.chat_history.append({"role": "user", "parts": user_message_parts})
            with st.chat_message("user"):
                st.markdown(prompt)
                if image:
                    st.image(image, width=200)
            with st.spinner("Thinking..."):
                response = chatbot.get_response(st.session_state.chat_history)
                st.session_state.chat_history.append({"role": "model", "parts": [response]})
            # Clear prompt and file uploader after sending
            chat_input_placeholder.empty()
            st.experimental_rerun()

if __name__ == "__main__":
    main()
