import streamlit as st
import chatbot
import time
from PIL import Image
from io import BytesIO

# A wrapper class to mimic the UploadedFile object from Streamlit
class InMemoryFile:
    def __init__(self, name, type, data):
        self.name = name
        self.type = type
        self._data = data

    def getvalue(self):
        return self._data

def main():
    st.set_page_config(page_title="AI Petcare Assistant", page_icon="🐾")

    # Get pet details
    if "pet_details_submitted" not in st.session_state:
        st.session_state.pet_details_submitted = False

    if not st.session_state.pet_details_submitted:
        with st.form("pet_details_form"):
            st.title("🐾 AI Petcare Assistant")
            st.write("Please enter your pet's details to start:")
            pet_name = st.text_input("Pet's Name")
            pet_type = st.selectbox("Pet Type", ["Dog", "Cat"])
            pet_age = st.text_input("Pet's Age")
            pet_breed = st.text_input("Pet's Breed")
            submitted = st.form_submit_button("Start Chatting")

            if submitted and pet_name and pet_type and pet_age and pet_breed:
                chatbot.pet_name = pet_name
                chatbot.pet_type = pet_type
                chatbot.pet_age = pet_age
                chatbot.pet_breed = pet_breed
                st.session_state.pet_details_submitted = True
                st.session_state.messages = [{"role": "assistant", "content": f"Great! I'm ready to help with {pet_name}. What's on your mind?"}]
                st.rerun()
            elif submitted:
                st.error("Please fill out all the pet details.")
    else:
        st.title(f"🐾 AI Petcare for {chatbot.pet_name}")

        # Display chat messages
        for message in st.session_state.messages:
            with st.chat_message(message["role"]):
                # Handle text content
                if "content" in message:
                    st.markdown(message["content"])
                # Handle file content
                if "files" in message:
                    for file_info in message["files"]:
                        if file_info["type"].startswith("image/"):
                            st.image(file_info["data"], caption=file_info["name"], width=200)
                        elif file_info["type"].startswith("audio/"):
                            st.audio(file_info["data"], format=file_info["type"])
                        elif file_info["type"].startswith("video/"):
                            st.video(file_info["data"], format=file_info["type"])

        # File uploader and chat input
        uploaded_files = st.file_uploader(
            "Upload files", type=["png", "jpg", "jpeg", "mp3", "wav", "mp4"], 
            accept_multiple_files=True, key="file_uploader"
        )
        prompt = st.chat_input("What is up?")

        if prompt:
            user_message = {"role": "user", "content": prompt}
            if uploaded_files:
                user_message["files"] = []
                for file in uploaded_files:
                    user_message["files"].append({
                        "name": file.name,
                        "type": file.type,
                        "data": file.getvalue()
                    })
            st.session_state.messages.append(user_message)
            st.rerun()

        # Assistant response logic
        if st.session_state.messages[-1]["role"] == "user":
            with st.chat_message("assistant"):
                message_placeholder = st.empty()
                full_response = ""

                # Prepare history for Gemini
                gemini_history = []
                for msg in st.session_state.messages:
                    role = "model" if msg["role"] == "assistant" else "user"
                    parts = []
                    if "content" in msg:
                        parts.append(msg["content"])
                    if "files" in msg:
                        for file_info in msg["files"]:
                            # Create an in-memory file-like object
                            in_memory_file = InMemoryFile(name=file_info["name"], type=file_info["type"], data=file_info["data"])
                            prepared_file = chatbot.prepare_file(in_memory_file)
                            parts.append(prepared_file)
                    gemini_history.append({"role": role, "parts": parts})

                assistant_response = chatbot.get_response(gemini_history)

                # Simulate stream of response
                for chunk in assistant_response.split():
                    full_response += chunk + " "
                    time.sleep(0.05)
                    message_placeholder.markdown(full_response + "▌")
                message_placeholder.markdown(full_response)
            
            st.session_state.messages.append({"role": "assistant", "content": full_response})
            # No need to rerun here, as the message is already displayed

if __name__ == "__main__":
    main()
